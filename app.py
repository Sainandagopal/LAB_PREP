import os
import io
import re
import json
from flask import Flask, render_template, request, jsonify, session
from werkzeug.utils import secure_filename
import PyPDF2

# Optional: OpenAI integration
try:
    import openai
    OPENAI_AVAILABLE = True
except ImportError:
    OPENAI_AVAILABLE = False

app = Flask(__name__)
app.secret_key = os.environ.get('SECRET_KEY', os.urandom(24))
app.config['UPLOAD_FOLDER'] = 'uploads'
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024  # 16MB max

os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)

ALLOWED_EXTENSIONS = {'pdf'}

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

def extract_text_from_pdf(file_path):
    """Extract text from uploaded PDF"""
    text = ""
    try:
        with open(file_path, 'rb') as file:
            pdf_reader = PyPDF2.PdfReader(file)
            for page in pdf_reader.pages:
                text += page.extract_text() + "\n"
    except Exception as e:
        return f"Error extracting PDF: {str(e)}"
    return text.strip()

def call_openai(prompt, model="gpt-3.5-turbo", max_tokens=1000):
    """Call OpenAI API if available"""
    if not OPENAI_AVAILABLE or not os.environ.get('OPENAI_API_KEY'):
        return None
    
    try:
        client = openai.OpenAI(api_key=os.environ.get('OPENAI_API_KEY'))
        response = client.chat.completions.create(
            model=model,
            messages=[{"role": "user", "content": prompt}],
            max_tokens=max_tokens,
            temperature=0.7
        )
        return response.choices[0].message.content
    except Exception as e:
        return f"OpenAI Error: {str(e)}"

def mock_summary(text):
    """Fallback summary without AI"""
    sentences = re.split(r'[.!?]+', text)
    sentences = [s.strip() for s in sentences if len(s.strip()) > 20]
    return " ".join(sentences[:5]) + "..." if sentences else "No content found."

def mock_steps(text):
    """Fallback step generation without AI"""
    steps = []
    lines = text.split('\n')
    for line in lines:
        line = line.strip()
        if re.match(r'^(\d+\.|Step|First|Then|Next|Finally)', line, re.IGNORECASE):
            steps.append(line)
    if not steps:
        steps = [
            "1. Read the experiment objectives carefully",
            "2. Gather all required apparatus and materials",
            "3. Set up the experimental setup as per diagram",
            "4. Follow the procedure step by step",
            "5. Record observations and calculations",
            "6. Analyze results and draw conclusions"
        ]
    return steps[:10]

def mock_viva(text):
    """Fallback viva questions without AI"""
    keywords = re.findall(r'\b[A-Z][a-z]+(?:\s[A-Z][a-z]+)*\b', text)
    key_terms = list(set(keywords))[:5] if keywords else ["experiment", "procedure", "result"]
    
    questions = [
        f"What is the main objective of this experiment?",
        f"Explain the principle behind {key_terms[0] if key_terms else 'this experiment'}.",
        f"What apparatus is required for this experiment?",
        f"What precautions should be taken during the experiment?",
        f"How would you calculate the final result?",
        f"What are possible sources of error in this experiment?",
        f"What is the significance of {key_terms[-1] if key_terms else 'the results'}?",
        f"Can you explain the formula used in this experiment?"
    ]
    return questions[:6]

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/upload', methods=['POST'])
def upload_file():
    if 'file' not in request.files:
        return jsonify({'error': 'No file part'}), 400
    
    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': 'No selected file'}), 400
    
    if file and allowed_file(file.filename):
        filename = secure_filename(file.filename)
        filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        file.save(filepath)
        
        # Extract text
        text = extract_text_from_pdf(filepath)
        
        if not text or text.startswith("Error"):
            return jsonify({'error': text or 'Could not extract text from PDF'}), 400
        
        # Store in session
        session['pdf_text'] = text
        session['pdf_filename'] = filename
        session['experiment_context'] = text[:3000]  # Limit context for AI
        
        return jsonify({
            'success': True,
            'filename': filename,
            'text_length': len(text),
            'preview': text[:500] + "..." if len(text) > 500 else text
        })
    
    return jsonify({'error': 'Invalid file type. Please upload a PDF.'}), 400

@app.route('/summarize', methods=['POST'])
def summarize():
    text = session.get('experiment_context', '')
    if not text:
        return jsonify({'error': 'No experiment uploaded yet'}), 400
    
    prompt = f"""
    Summarize the following experiment in clear, concise language suitable for a lab student.
    Include: objective, key concepts, and expected outcome.
    
    Experiment Text:
    {text}
    """
    
    ai_summary = call_openai(prompt, max_tokens=600)
    if ai_summary and not ai_summary.startswith("OpenAI Error"):
        summary = ai_summary
    else:
        summary = mock_summary(text)
    
    return jsonify({'summary': summary})

@app.route('/steps', methods=['POST'])
def steps():
    text = session.get('experiment_context', '')
    if not text:
        return jsonify({'error': 'No experiment uploaded yet'}), 400
    
    prompt = f"""
    Based on the following experiment text, provide a clear step-by-step implementation procedure.
    Number each step. Make it practical and easy to follow for a lab student.
    
    Experiment Text:
    {text}
    """
    
    ai_steps = call_openai(prompt, max_tokens=800)
    if ai_steps and not ai_steps.startswith("OpenAI Error"):
        # Parse numbered steps
        step_list = [s.strip() for s in ai_steps.split('\n') if s.strip() and re.match(r'^\d+[\.\)]', s.strip())]
        if not step_list:
            step_list = [s.strip() for s in ai_steps.split('\n') if s.strip()]
    else:
        step_list = mock_steps(text)
    
    return jsonify({'steps': step_list})

@app.route('/viva', methods=['POST'])
def viva():
    text = session.get('experiment_context', '')
    if not text:
        return jsonify({'error': 'No experiment uploaded yet'}), 400
    
    prompt = f"""
    Based on the following experiment, generate 8-10 viva voce (oral exam) questions 
    that an examiner might ask a student. Mix of conceptual, procedural, and calculation questions.
    
    Experiment Text:
    {text}
    """
    
    ai_viva = call_openai(prompt, max_tokens=700)
    if ai_viva and not ai_viva.startswith("OpenAI Error"):
        questions = [q.strip() for q in ai_viva.split('\n') if q.strip() and re.match(r'^(\d+[\.\)]|[-•])', q.strip())]
        if not questions:
            questions = [q.strip() for q in ai_viva.split('\n') if q.strip() and '?' in q]
    else:
        questions = mock_viva(text)
    
    return jsonify({'questions': questions})

@app.route('/chat', methods=['POST'])
def chat():
    data = request.get_json()
    user_question = data.get('question', '')
    context = session.get('experiment_context', '')
    
    if not context:
        return jsonify({'error': 'No experiment context available'}), 400
    
    prompt = f"""
    You are a lab assistant helping a student prepare for their experiment.
    Answer the following question based ONLY on the experiment context provided.
    If the answer is not in the context, say so honestly.
    
    Experiment Context:
    {context[:4000]}
    
    Student Question: {user_question}
    """
    
    ai_answer = call_openai(prompt, max_tokens=500)
    if ai_answer and not ai_answer.startswith("OpenAI Error"):
        answer = ai_answer
    else:
        answer = f"Based on the experiment document, I can help you with general questions about: {', '.join(context.split()[:10])}... (Upgrade with OpenAI API key for detailed AI answers)"
    
    return jsonify({'answer': answer})

@app.route('/reset', methods=['POST'])
def reset():
    session.clear()
    return jsonify({'success': True})

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=False)
