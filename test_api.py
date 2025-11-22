import requests
import time
import subprocess
import sys
import os

# Start the server in the background
server_process = subprocess.Popen(
    [sys.executable, "-m", "uvicorn", "main:app", "--port", "8001"],
    cwd=os.getcwd(),
    stdout=subprocess.PIPE,
    stderr=subprocess.PIPE
)

BASE_URL = "http://127.0.0.1:8001/api"

try:
    print("Waiting for server to start...")
    time.sleep(3) # Wait for server startup

    # 1. Create Note
    print("Testing Create Note...")
    note_data = {
        "title": "TestNote",
        "content": "Hello [[World]] this is a #test note."
    }
    res = requests.post(f"{BASE_URL}/notes/TestNote", json=note_data)
    assert res.status_code == 200
    print("Create Note: OK")

    # 2. Get Note
    print("Testing Get Note...")
    res = requests.get(f"{BASE_URL}/notes/TestNote")
    assert res.status_code == 200
    data = res.json()
    assert data["title"] == "TestNote"
    assert "World" in data["links"]
    assert "test" in data["tags"]
    print("Get Note: OK")

    # 3. List Notes
    print("Testing List Notes...")
    res = requests.get(f"{BASE_URL}/notes")
    assert res.status_code == 200
    notes = res.json()
    assert any(n["title"] == "TestNote" for n in notes)
    print("List Notes: OK")

    # 4. Get Tags
    print("Testing Get Tags...")
    res = requests.get(f"{BASE_URL}/tags")
    assert res.status_code == 200
    tags = res.json()
    assert any(t["name"] == "test" for t in tags)
    print("Get Tags: OK")

    # 5. Get Graph
    print("Testing Get Graph...")
    res = requests.get(f"{BASE_URL}/graph")
    assert res.status_code == 200
    graph = res.json()
    elements = graph["elements"]
    # Check for nodes
    node_ids = [el["data"]["id"] for el in elements if "source" not in el["data"]]
    assert "TestNote" in node_ids
    assert "World" in node_ids # Ghost node
    # Check for edge
    edges = [el["data"] for el in elements if "source" in el["data"]]
    assert any(e["source"] == "TestNote" and e["target"] == "World" for e in edges)
    print("Get Graph: OK")

    # 6. Delete Note
    print("Testing Delete Note...")
    res = requests.delete(f"{BASE_URL}/notes/TestNote")
    assert res.status_code == 200
    # Verify deletion
    res = requests.get(f"{BASE_URL}/notes/TestNote")
    assert res.status_code == 404
    print("Delete Note: OK")

    print("\nAll tests passed!")

except Exception as e:
    print(f"Test failed: {e}")
    # Print server output for debugging
    out, err = server_process.communicate(timeout=1)
    print("Server Output:", out.decode())
    print("Server Error:", err.decode())

finally:
    server_process.terminate()
