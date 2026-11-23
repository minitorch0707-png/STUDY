"""Generates realistic sample course files used by the automated tests and demo.
Run: python3 test-fixtures/make_fixtures.py"""
import os
from pptx import Presentation
from pptx.util import Inches
from docx import Document
from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas

OUT = os.path.join(os.path.dirname(__file__), "files")
os.makedirs(OUT, exist_ok=True)

# --- PowerPoint lecture ---
prs = Presentation()
s = prs.slides.add_slide(prs.slide_layouts[0])
s.shapes.title.text = "Week 3: Mens Rea"
s.placeholders[1].text = "Criminal Law 101 — Lecture 3"
slides = [
    ("What is mens rea?", ["The mental element of a crime", "Latin: 'guilty mind'", "Must coincide with the actus reus (contemporaneity)"], "Stress that both elements are required for most offences."),
    ("Subjective mens rea", ["Focuses on what the accused actually knew or intended", "Intention: purpose or desire to bring about the consequence", "Recklessness: conscious awareness of a risk, proceeding anyway", "Wilful blindness: deliberately avoiding confirming a suspicion"], "Students often confuse recklessness with negligence. Emphasise awareness."),
    ("Objective mens rea", ["Measured against the reasonable person standard", "Criminal negligence: marked departure from reasonable conduct", "No proof of actual awareness needed"], None),
    ("Comparing the two standards", None, None),
]
for title, bullets, notes in slides:
    sl = prs.slides.add_slide(prs.slide_layouts[1])
    sl.shapes.title.text = title
    if bullets:
        tf = sl.placeholders[1].text_frame
        tf.text = bullets[0]
        for b in bullets[1:]:
            p = tf.add_paragraph(); p.text = b; p.level = 1 if b.startswith("Must") else 0
    else:
        sl.placeholders[1].text = "Key differences"
        rows = [("", "Subjective", "Objective"), ("Question asked", "What did the accused know?", "What would a reasonable person know?"), ("Example offence", "Murder", "Dangerous driving")]
        tbl = sl.shapes.add_table(3, 3, Inches(0.5), Inches(2.5), Inches(9), Inches(2)).table
        for r, row in enumerate(rows):
            for c, val in enumerate(row):
                tbl.cell(r, c).text = val
    if notes:
        sl.notes_slide.notes_text_frame.text = notes
prs.save(os.path.join(OUT, "Week 3 - Lecture 3 - Mens Rea.pptx"))

# --- Word syllabus ---
d = Document()
d.add_heading("LAW 101: Criminal Law — Course Syllabus", 0)
d.add_paragraph("Professor: Dr. Jane Smith. Fall 2026. Office hours: Tuesdays 2-4pm.")
d.add_heading("Assessment", 1)
t = d.add_table(rows=4, cols=3)
for r, row in enumerate([("Component", "Weight", "Date"), ("Midterm Exam", "30%", "October 20, 2026"), ("Research Essay", "25%", "Due November 10, 2026"), ("Final Exam", "45%", "December 14, 2026")]):
    for c, v in enumerate(row):
        t.cell(r, c).text = v
d.add_paragraph("The midterm exam will consist of multiple choice and short answer questions. The final exam includes an essay question.")
d.add_heading("Weekly Schedule", 1)
for w, topic in [(1, "Introduction to criminal law"), (2, "Actus reus"), (3, "Mens rea: subjective and objective standards"), (4, "Defences: necessity and duress")]:
    d.add_paragraph(f"Week {w}: {topic}", style="List Bullet")
d.add_paragraph("Reading: Chapter 4 must be completed by Sept 22, 2026.")
d.save(os.path.join(OUT, "LAW101 Syllabus.docx"))

# --- PDF reading ---
c = canvas.Canvas(os.path.join(OUT, "Reading - Actus Reus.pdf"), pagesize=letter)
c.setFont("Helvetica-Bold", 20); c.drawString(72, 720, "Actus Reus: The Physical Element")
c.setFont("Helvetica", 11)
y = 690
for line in ["The actus reus is the physical element of an offence. It includes conduct,",
             "circumstances and, for result crimes, consequences.",
             "An omission can satisfy the actus reus only where there is a legal duty to act.",
             "Voluntariness is required: involuntary movements are not criminal acts."]:
    c.drawString(72, y, line); y -= 16
c.showPage()
c.setFont("Helvetica-Bold", 18); c.drawString(72, 720, "Causation")
c.setFont("Helvetica", 11)
c.drawString(72, 690, "Factual causation asks whether the result would have occurred 'but for' the conduct.")
c.drawString(72, 674, "Legal causation asks whether the accused's contribution was significant.")
c.showPage()
c.showPage()  # blank page (simulates scanned / image-only page)
c.save()
print("fixtures written to", OUT)
