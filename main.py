from fastapi import FastAPI, HTTPException, UploadFile, File, Body
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel
import os
import re
import glob
import shutil
from datetime import datetime
from typing import List, Dict, Optional

app = FastAPI()

# Ensure notes directory exists
NOTES_DIR = "notes"
ASSETS_DIR = os.path.join(NOTES_DIR, "assets")
os.makedirs(ASSETS_DIR, exist_ok=True)

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], # Allows all origins
    allow_credentials=True,
    allow_methods=["*"], # Allows all methods
    allow_headers=["*"], # Allows all headers
)

# Mount static files
app.mount("/static", StaticFiles(directory="static"), name="static")
app.mount("/assets", StaticFiles(directory=ASSETS_DIR), name="assets")

class Note(BaseModel):
    title: str
    content: str
    tags: List[str] = []
    links: List[str] = []

def parse_note_content(content: str):
    # Extract [[links]]
    links = re.findall(r'\[\[(.*?)\]\]', content)
    # Extract #tags (simple regex, can be improved)
    tags = re.findall(r'#([\w-]+)', content)
    return list(set(links)), list(set(tags))

def get_note_path(title: str):
    # Sanitize title to prevent path traversal (basic)
    safe_title = os.path.basename(title)
    return os.path.join(NOTES_DIR, f"{safe_title}.md")

@app.get("/")
async def read_root():
    return FileResponse("static/index.html")

@app.get("/api/notes")
async def list_notes():
    notes = []
    files = glob.glob(os.path.join(NOTES_DIR, "*.md"))
    for f in files:
        title = os.path.splitext(os.path.basename(f))[0]
        with open(f, 'r', encoding='utf-8') as file:
            content = file.read()
            links, tags = parse_note_content(content)
            notes.append({"title": title, "tags": tags})
    return notes

@app.get("/api/notes/{title}")
async def get_note(title: str):
    path = get_note_path(title)
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="Note not found")
    
    with open(path, 'r', encoding='utf-8') as f:
        content = f.read()
    
    links, tags = parse_note_content(content)
    return {"title": title, "content": content, "links": links, "tags": tags}

@app.post("/api/notes/{title}")
async def save_note(title: str, note: Note = Body(...)):
    path = get_note_path(title)
    # If title changed (renaming), handle that? For now, simple save.
    # If the user changes the title in the UI, it might be a new note or a rename.
    # Let's assume the UI handles the "new note" vs "update" logic by calling with the correct title.
    
    with open(path, 'w', encoding='utf-8') as f:
        f.write(note.content)
    
    return {"status": "success", "title": title}

@app.delete("/api/notes/{title}")
async def delete_note(title: str):
    path = get_note_path(title)
    if os.path.exists(path):
        os.remove(path)
        return {"status": "success"}
    raise HTTPException(status_code=404, detail="Note not found")

@app.get("/api/graph")
def get_graph():
    elements = []
    existing_nodes = set()
    
    # Nodes
    for filepath in glob.glob(os.path.join(NOTES_DIR, "*.md")):
        filename = os.path.basename(filepath)
        title = os.path.splitext(filename)[0]
        existing_nodes.add(title)
        elements.append({"data": {"id": title}})

    # Edges
    for filepath in glob.glob(os.path.join(NOTES_DIR, "*.md")):
        filename = os.path.basename(filepath)
        source = os.path.splitext(filename)[0]
        
        with open(filepath, "r", encoding="utf-8") as f:
            content = f.read()
            links = re.findall(r'\[\[(.*?)\]\]', content)
            for target in links:
                # Add edge
                elements.append({"data": {"source": source, "target": target}})
                
                # Add ghost node if target doesn't exist
                if target not in existing_nodes:
                    elements.append({"data": {"id": target, "ghost": True}})
                    existing_nodes.add(target)

    return {"elements": elements}

@app.post("/api/upload")
async def upload_file(file: UploadFile = File(...)):
    # Generate unique filename to prevent overwrites
    timestamp = datetime.now().strftime("%Y%m%d%H%M%S")
    filename = f"{timestamp}_{file.filename}"
    filepath = os.path.join(ASSETS_DIR, filename)
    
    with open(filepath, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
        
    return {"filename": filename, "url": f"/assets/{filename}"}

@app.get("/api/tags")
async def get_tags():
    tag_counts = {}
    files = glob.glob(os.path.join(NOTES_DIR, "*.md"))
    for f in files:
        with open(f, 'r', encoding='utf-8') as file:
            content = file.read()
            _, tags = parse_note_content(content)
            for tag in tags:
                tag_counts[tag] = tag_counts.get(tag, 0) + 1
    
    return [{"name": tag, "count": count} for tag, count in tag_counts.items()]

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
