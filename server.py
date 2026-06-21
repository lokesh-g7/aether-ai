import http.server
import socketserver
import json
import sqlite3
import os
import hashlib
import uuid
import urllib.parse
import mimetypes
from datetime import datetime

PORT = 8000
DB_FILE = "database.db"

# --- Database Helper Functions ---
def get_db():
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db()
    cursor = conn.cursor()
    
    # Users table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        salt TEXT NOT NULL,
        created_at TEXT NOT NULL
    )
    """)
    
    # Sessions table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    )
    """)
    
    # Chats table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS chats (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        title TEXT NOT NULL,
        messages_json TEXT NOT NULL,
        is_pinned INTEGER DEFAULT 0,
        created_at TEXT NOT NULL,
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    )
    """)
    
    # Projects table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        instructions TEXT,
        files_json TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    )
    """)
    
    # Personalization table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS personalization (
        user_id TEXT PRIMARY KEY,
        tone TEXT DEFAULT 'Default',
        name TEXT DEFAULT '',
        occupation TEXT DEFAULT '',
        interests TEXT DEFAULT '',
        custom_instructions TEXT DEFAULT '',
        memory_reference INTEGER DEFAULT 1,
        history_reference INTEGER DEFAULT 1,
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    )
    """)
    
    # Settings table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS settings (
        user_id TEXT PRIMARY KEY,
        api_key TEXT DEFAULT '',
        model TEXT DEFAULT 'gemini-2.5-flash-preview-05-20',
        temperature REAL DEFAULT 0.7,
        system_instruction TEXT DEFAULT 'You are a helpful, precise, and stylish AI coding assistant.',
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    )
    """)
    
    conn.commit()
    conn.close()

# --- Password Salting & Hashing ---
def hash_password(password, salt=None):
    if not salt:
        salt = os.urandom(16).hex()
    pwd_bytes = password.encode('utf-8')
    salt_bytes = salt.encode('utf-8')
    # Hash password + salt
    hashed = hashlib.sha256(pwd_bytes + salt_bytes).hexdigest()
    return hashed, salt

# --- Request Handler Class ---
class AetherRequestHandler(http.server.SimpleHTTPRequestHandler):
    
    def log_message(self, format, *args):
        # Suppress noise logs, keep error details
        pass
        
    def end_headers(self):
        # Enable CORS for cross-origin fetches if needed
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, DELETE, PUT')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def get_authenticated_user(self):
        auth_header = self.headers.get('Authorization')
        if not auth_header or not auth_header.startswith('Bearer '):
            return None
        token = auth_header.split(' ')[1]
        
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("""
            SELECT users.* FROM sessions 
            JOIN users ON sessions.user_id = users.id 
            WHERE sessions.token = ?
        """, (token,))
        user = cursor.fetchone()
        conn.close()
        return user

    def do_GET(self):
        parsed_url = urllib.parse.urlparse(self.path)
        path = parsed_url.path
        
        # --- API Endpoints ---
        if path.startswith("/api/"):
            user = self.get_authenticated_user()
            
            if path == "/api/profile":
                if not user:
                    self.send_api_response({"error": "Unauthorized"}, 401)
                    return
                self.send_api_response({
                    "id": user["id"],
                    "name": user["name"],
                    "email": user["email"]
                })
                return

            elif path == "/api/chats":
                if not user:
                    self.send_api_response({"error": "Unauthorized"}, 401)
                    return
                
                conn = get_db()
                cursor = conn.cursor()
                cursor.execute("SELECT * FROM chats WHERE user_id = ? ORDER BY created_at DESC", (user["id"],))
                rows = cursor.fetchall()
                chats_list = []
                for row in rows:
                    chats_list.append({
                        "id": row["id"],
                        "title": row["title"],
                        "messages": json.loads(row["messages_json"]),
                        "isPinned": bool(row["is_pinned"])
                    })
                conn.close()
                self.send_api_response(chats_list)
                return

            elif path == "/api/projects":
                if not user:
                    self.send_api_response({"error": "Unauthorized"}, 401)
                    return
                
                conn = get_db()
                cursor = conn.cursor()
                cursor.execute("SELECT * FROM projects WHERE user_id = ? ORDER BY created_at DESC", (user["id"],))
                rows = cursor.fetchall()
                projects_list = []
                for row in rows:
                    projects_list.append({
                        "id": row["id"],
                        "title": row["title"],
                        "description": row["description"],
                        "instructions": row["instructions"],
                        "files": json.loads(row["files_json"]) if row["files_json"] else []
                    })
                conn.close()
                self.send_api_response(projects_list)
                return

            elif path == "/api/personalization":
                if not user:
                    self.send_api_response({"error": "Unauthorized"}, 401)
                    return
                
                conn = get_db()
                cursor = conn.cursor()
                cursor.execute("SELECT * FROM personalization WHERE user_id = ?", (user["id"],))
                row = cursor.fetchone()
                
                if not row:
                    # Insert defaults
                    cursor.execute("INSERT INTO personalization (user_id) VALUES (?)", (user["id"],))
                    conn.commit()
                    cursor.execute("SELECT * FROM personalization WHERE user_id = ?", (user["id"],))
                    row = cursor.fetchone()
                    
                data = {
                    "tone": row["tone"],
                    "name": row["name"],
                    "occupation": row["occupation"],
                    "interests": row["interests"],
                    "customInstructions": row["custom_instructions"],
                    "memoryReference": bool(row["memory_reference"]),
                    "historyReference": bool(row["history_reference"])
                }
                conn.close()
                self.send_api_response(data)
                return

            elif path == "/api/settings":
                if not user:
                    self.send_api_response({"error": "Unauthorized"}, 401)
                    return
                
                conn = get_db()
                cursor = conn.cursor()
                cursor.execute("SELECT * FROM settings WHERE user_id = ?", (user["id"],))
                row = cursor.fetchone()
                
                if not row:
                    # Insert defaults
                    cursor.execute("INSERT INTO settings (user_id) VALUES (?)", (user["id"],))
                    conn.commit()
                    cursor.execute("SELECT * FROM settings WHERE user_id = ?", (user["id"],))
                    row = cursor.fetchone()
                    
                data = {
                    "apiKey": row["api_key"],
                    "model": row["model"],
                    "temperature": row["temperature"],
                    "systemInstruction": row["system_instruction"]
                }
                conn.close()
                self.send_api_response(data)
                return

            else:
                self.send_api_response({"error": "Not Found"}, 404)
                return
        
        # --- Static File Server ---
        else:
            # Map empty path to index.html
            file_path = path[1:] if path != "/" else "index.html"
            
            # Prevent directory traversal
            normalized_path = os.path.normpath(file_path)
            if normalized_path.startswith("..") or os.path.isabs(normalized_path):
                self.send_response(403)
                self.end_headers()
                return
            
            if os.path.exists(normalized_path) and os.path.isfile(normalized_path):
                self.send_response(200)
                content_type, _ = mimetypes.guess_type(normalized_path)
                self.send_header("Content-Type", content_type or "application/octet-stream")
                self.end_headers()
                with open(normalized_path, "rb") as f:
                    self.wfile.write(f.read())
            else:
                # Fallback to index.html for SPA routing or send 404
                if os.path.exists("index.html"):
                    self.send_response(200)
                    self.send_header("Content-Type", "text/html")
                    self.end_headers()
                    with open("index.html", "rb") as f:
                        self.wfile.write(f.read())
                else:
                    self.send_response(404)
                    self.end_headers()

    def do_POST(self):
        parsed_url = urllib.parse.urlparse(self.path)
        path = parsed_url.path
        
        content_length = int(self.headers.get('Content-Length', 0))
        post_data = self.rfile.read(content_length).decode('utf-8')
        
        try:
            body = json.loads(post_data) if post_data else {}
        except json.JSONDecodeError:
            self.send_api_response({"error": "Invalid JSON"}, 400)
            return
            
        # --- Authentication Endpoints ---
        if path == "/api/auth/signup":
            name = body.get("name", "").strip()
            email = body.get("email", "").strip().lower()
            password = body.get("password", "")
            
            if not name or not email or not password:
                self.send_api_response({"error": "Name, email and password are required"}, 400)
                return
                
            conn = get_db()
            cursor = conn.cursor()
            cursor.execute("SELECT id FROM users WHERE email = ?", (email,))
            if cursor.fetchone():
                conn.close()
                self.send_api_response({"error": "Account with this email already exists"}, 409)
                return
                
            # Create user
            user_id = str(uuid.uuid4())
            pwd_hash, salt = hash_password(password)
            created_at = datetime.utcnow().isoformat()
            
            try:
                cursor.execute("""
                    INSERT INTO users (id, name, email, password_hash, salt, created_at)
                    VALUES (?, ?, ?, ?, ?, ?)
                """, (user_id, name, email, pwd_hash, salt, created_at))
                
                # Create session token
                session_token = str(uuid.uuid4())
                cursor.execute("""
                    INSERT INTO sessions (token, user_id, created_at)
                    VALUES (?, ?, ?)
                """, (session_token, user_id, created_at))
                
                conn.commit()
                self.send_api_response({
                    "token": session_token,
                    "user": {"id": user_id, "name": name, "email": email}
                })
            except Exception as e:
                self.send_api_response({"error": f"Database error: {str(e)}"}, 500)
            finally:
                conn.close()
            return

        elif path == "/api/auth/login":
            email = body.get("email", "").strip().lower()
            password = body.get("password", "")
            is_google_oauth = body.get("isGoogleOAuth", False)
            
            conn = get_db()
            cursor = conn.cursor()
            
            if is_google_oauth:
                name = body.get("name", "Google User")
                # Google authentication simulation bypasses password verification
                cursor.execute("SELECT * FROM users WHERE email = ?", (email,))
                user = cursor.fetchone()
                
                if not user:
                    # Auto-register Google user
                    user_id = str(uuid.uuid4())
                    pwd_hash, salt = hash_password(str(uuid.uuid4())) # random password
                    created_at = datetime.utcnow().isoformat()
                    cursor.execute("""
                        INSERT INTO users (id, name, email, password_hash, salt, created_at)
                        VALUES (?, ?, ?, ?, ?, ?)
                    """, (user_id, name, email, pwd_hash, salt, created_at))
                    user = {"id": user_id, "name": name, "email": email}
                else:
                    user = dict(user)
                    
                session_token = str(uuid.uuid4())
                created_at = datetime.utcnow().isoformat()
                cursor.execute("INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)", 
                               (session_token, user["id"], created_at))
                conn.commit()
                conn.close()
                
                self.send_api_response({
                    "token": session_token,
                    "user": {"id": user["id"], "name": user["name"], "email": user["email"]}
                })
                return
            
            # Standard password flow
            cursor.execute("SELECT * FROM users WHERE email = ?", (email,))
            user = cursor.fetchone()
            
            if not user:
                conn.close()
                self.send_api_response({"error": "Invalid email or password"}, 401)
                return
                
            pwd_hash, _ = hash_password(password, user["salt"])
            if pwd_hash != user["password_hash"]:
                conn.close()
                self.send_api_response({"error": "Invalid email or password"}, 401)
                return
                
            # Create session token
            session_token = str(uuid.uuid4())
            created_at = datetime.utcnow().isoformat()
            cursor.execute("INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)", 
                           (session_token, user["id"], created_at))
            conn.commit()
            conn.close()
            
            self.send_api_response({
                "token": session_token,
                "user": {"id": user["id"], "name": user["name"], "email": user["email"]}
            })
            return

        elif path == "/api/auth/logout":
            auth_header = self.headers.get('Authorization')
            if auth_header and auth_header.startswith('Bearer '):
                token = auth_header.split(' ')[1]
                conn = get_db()
                cursor = conn.cursor()
                cursor.execute("DELETE FROM sessions WHERE token = ?", (token,))
                conn.commit()
                conn.close()
            self.send_api_response({"message": "Successfully logged out"})
            return
            
        # --- Authenticated Data Write Endpoints ---
        user = self.get_authenticated_user()
        if not user:
            self.send_api_response({"error": "Unauthorized"}, 401)
            return

        if path == "/api/chats":
            chat_id = body.get("id")
            title = body.get("title", "New Conversation")
            messages = body.get("messages", [])
            is_pinned = 1 if body.get("isPinned", False) else 0
            
            if not chat_id:
                self.send_api_response({"error": "Chat ID is required"}, 400)
                return
                
            conn = get_db()
            cursor = conn.cursor()
            
            # Upsert chat
            cursor.execute("SELECT id FROM chats WHERE id = ? AND user_id = ?", (chat_id, user["id"]))
            exists = cursor.fetchone()
            
            created_at = datetime.utcnow().isoformat()
            messages_json = json.dumps(messages)
            
            if exists:
                cursor.execute("""
                    UPDATE chats 
                    SET title = ?, messages_json = ?, is_pinned = ? 
                    WHERE id = ? AND user_id = ?
                """, (title, messages_json, is_pinned, chat_id, user["id"]))
            else:
                cursor.execute("""
                    INSERT INTO chats (id, user_id, title, messages_json, is_pinned, created_at)
                    VALUES (?, ?, ?, ?, ?, ?)
                """, (chat_id, user["id"], title, messages_json, is_pinned, created_at))
                
            conn.commit()
            conn.close()
            self.send_api_response({"message": "Chat synced successfully"})
            return

        elif path == "/api/projects":
            proj_id = body.get("id")
            title = body.get("title", "New Project")
            description = body.get("description", "")
            instructions = body.get("instructions", "")
            files = body.get("files", [])
            
            if not proj_id:
                self.send_api_response({"error": "Project ID is required"}, 400)
                return
                
            conn = get_db()
            cursor = conn.cursor()
            
            # Upsert project
            cursor.execute("SELECT id FROM projects WHERE id = ? AND user_id = ?", (proj_id, user["id"]))
            exists = cursor.fetchone()
            
            created_at = datetime.utcnow().isoformat()
            files_json = json.dumps(files)
            
            if exists:
                cursor.execute("""
                    UPDATE projects 
                    SET title = ?, description = ?, instructions = ?, files_json = ? 
                    WHERE id = ? AND user_id = ?
                """, (title, description, instructions, files_json, proj_id, user["id"]))
            else:
                cursor.execute("""
                    INSERT INTO projects (id, user_id, title, description, instructions, files_json, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                """, (proj_id, user["id"], title, description, instructions, files_json, created_at))
                
            conn.commit()
            conn.close()
            self.send_api_response({"message": "Project synced successfully"})
            return

        elif path == "/api/personalization":
            tone = body.get("tone", "Default")
            name = body.get("name", "")
            occupation = body.get("occupation", "")
            interests = body.get("interests", "")
            custom_instructions = body.get("customInstructions", "")
            memory_reference = 1 if body.get("memoryReference", True) else 0
            history_reference = 1 if body.get("historyReference", True) else 0
            
            conn = get_db()
            cursor = conn.cursor()
            
            cursor.execute("""
                INSERT INTO personalization (user_id, tone, name, occupation, interests, custom_instructions, memory_reference, history_reference)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(user_id) DO UPDATE SET
                    tone=excluded.tone,
                    name=excluded.name,
                    occupation=excluded.occupation,
                    interests=excluded.interests,
                    custom_instructions=excluded.custom_instructions,
                    memory_reference=excluded.memory_reference,
                    history_reference=excluded.history_reference
            """, (user["id"], tone, name, occupation, interests, custom_instructions, memory_reference, history_reference))
            
            conn.commit()
            conn.close()
            self.send_api_response({"message": "Personalization synced successfully"})
            return

        elif path == "/api/settings":
            api_key = body.get("apiKey", "")
            model = body.get("model", "gemini-2.5-flash")
            temperature = float(body.get("temperature", 0.7))
            system_instruction = body.get("systemInstruction", "")
            
            conn = get_db()
            cursor = conn.cursor()
            
            cursor.execute("""
                INSERT INTO settings (user_id, api_key, model, temperature, system_instruction)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(user_id) DO UPDATE SET
                    api_key=excluded.api_key,
                    model=excluded.model,
                    temperature=excluded.temperature,
                    system_instruction=excluded.system_instruction
            """, (user["id"], api_key, model, temperature, system_instruction))
            
            conn.commit()
            conn.close()
            self.send_api_response({"message": "Settings synced successfully"})
            return

        elif path == "/api/profile/update":
            name = body.get("name", "").strip()
            email = body.get("email", "").strip().lower()
            
            if not name or not email:
                self.send_api_response({"error": "Name and email are required"}, 400)
                return
                
            conn = get_db()
            cursor = conn.cursor()
            
            # Check unique email (if changed)
            if email != user["email"]:
                cursor.execute("SELECT id FROM users WHERE email = ? AND id != ?", (email, user["id"]))
                if cursor.fetchone():
                    conn.close()
                    self.send_api_response({"error": "Email is already taken by another account"}, 409)
                    return
            
            cursor.execute("UPDATE users SET name = ?, email = ? WHERE id = ?", (name, email, user["id"]))
            conn.commit()
            conn.close()
            self.send_api_response({
                "message": "Profile updated successfully",
                "user": {"id": user["id"], "name": name, "email": email}
            })
            return

        else:
            self.send_api_response({"error": "Not Found"}, 404)
            return

    def do_DELETE(self):
        parsed_url = urllib.parse.urlparse(self.path)
        path = parsed_url.path
        
        user = self.get_authenticated_user()
        if not user:
            self.send_api_response({"error": "Unauthorized"}, 401)
            return
            
        conn = get_db()
        cursor = conn.cursor()
        
        if path.startswith("/api/chats/"):
            chat_id = path.split("/")[-1]
            cursor.execute("DELETE FROM chats WHERE id = ? AND user_id = ?", (chat_id, user["id"]))
            conn.commit()
            conn.close()
            self.send_api_response({"message": "Chat deleted"})
            return

        elif path.startswith("/api/projects/"):
            proj_id = path.split("/")[-1]
            cursor.execute("DELETE FROM projects WHERE id = ? AND user_id = ?", (proj_id, user["id"]))
            conn.commit()
            conn.close()
            self.send_api_response({"message": "Project deleted"})
            return

        elif path == "/api/account":
            # Cascade delete accounts and sessions
            cursor.execute("DELETE FROM users WHERE id = ?", (user["id"],))
            conn.commit()
            conn.close()
            self.send_api_response({"message": "Account deleted successfully"})
            return
            
        else:
            conn.close()
            self.send_api_response({"error": "Not Found"}, 404)
            return

    def send_api_response(self, data, status_code=200):
        self.send_response(status_code)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps(data).encode('utf-8'))

# --- Server Startup ---
if __name__ == "__main__":
    init_db()
    print("Database initialised.")
    
    # Custom socketserver to allow immediate reuse of ports
    socketserver.TCPServer.allow_reuse_address = True
    
    with socketserver.TCPServer(("", PORT), AetherRequestHandler) as httpd:
        print(f"AetherAI secure database server running on port {PORT}")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            pass
        finally:
            httpd.server_close()
            print("\nServer stopped.")
