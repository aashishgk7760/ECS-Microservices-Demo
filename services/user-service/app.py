from fastapi import FastAPI, HTTPException, Depends
from pydantic import BaseModel
import asyncpg
import os
import logging
import json
import time
from typing import List, Optional
from ddtrace import tracer
import asyncio

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="User Service", version="1.0.0")

# Pydantic models
class UserCreate(BaseModel):
    name: str
    email: str
    age: Optional[int] = None

class UserUpdate(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None
    age: Optional[int] = None

class User(BaseModel):
    id: int
    name: str
    email: str
    age: Optional[int] = None
    created_at: str

# Database connection
async def get_db_connection():
    """Get database connection"""
    database_url = os.getenv('DATABASE_URL')
    database_password = os.getenv('DATABASE_PASSWORD')

    # For demo purposes, construct connection string
    # In production, use proper secret management
    connection_string = f"postgresql://postgres:{database_password}@{database_url}:5432/microservices"

    try:
        conn = await asyncpg.connect(connection_string)
        return conn
    except Exception as e:
        logger.error(f"Database connection failed: {e}")
        raise HTTPException(status_code=503, detail="Database unavailable")

@app.on_event("startup")
async def startup():
    """Initialize database tables"""
    try:
        conn = await get_db_connection()
        await conn.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                email VARCHAR(255) UNIQUE NOT NULL,
                age INTEGER,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        await conn.close()
        logger.info("Database initialized successfully")
    except Exception as e:
        logger.error(f"Database initialization failed: {e}")

@app.get("/health")
async def health():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "service": "user-service",
        "timestamp": int(time.time())
    }

@app.get("/users", response_model=List[User])
@tracer.wrap("user_service.get_users")
async def get_users():
    """Get all users"""
    conn = await get_db_connection()
    try:
        rows = await conn.fetch("SELECT * FROM users ORDER BY id")
        users = []
        for row in rows:
            users.append(User(
                id=row['id'],
                name=row['name'],
                email=row['email'],
                age=row['age'],
                created_at=row['created_at'].isoformat()
            ))
        return users
    finally:
        await conn.close()

@app.post("/users", response_model=User)
@tracer.wrap("user_service.create_user")
async def create_user(user: UserCreate):
    """Create a new user"""
    conn = await get_db_connection()
    try:
        row = await conn.fetchrow(
            "INSERT INTO users (name, email, age) VALUES ($1, $2, $3) RETURNING *",
            user.name, user.email, user.age
        )
        return User(
            id=row['id'],
            name=row['name'],
            email=row['email'],
            age=row['age'],
            created_at=row['created_at'].isoformat()
        )
    except asyncpg.UniqueViolationError:
        raise HTTPException(status_code=400, detail="Email already exists")
    finally:
        await conn.close()

@app.get("/users/{user_id}", response_model=User)
@tracer.wrap("user_service.get_user")
async def get_user(user_id: int):
    """Get user by ID"""
    conn = await get_db_connection()
    try:
        row = await conn.fetchrow("SELECT * FROM users WHERE id = $1", user_id)
        if not row:
            raise HTTPException(status_code=404, detail="User not found")

        return User(
            id=row['id'],
            name=row['name'],
            email=row['email'],
            age=row['age'],
            created_at=row['created_at'].isoformat()
        )
    finally:
        await conn.close()

@app.put("/users/{user_id}", response_model=User)
@tracer.wrap("user_service.update_user")
async def update_user(user_id: int, user_update: UserUpdate):
    """Update user by ID"""
    conn = await get_db_connection()
    try:
        # Check if user exists
        existing = await conn.fetchrow("SELECT * FROM users WHERE id = $1", user_id)
        if not existing:
            raise HTTPException(status_code=404, detail="User not found")

        # Build dynamic update query
        update_fields = []
        values = []
        param_count = 1

        if user_update.name is not None:
            update_fields.append(f"name = ${param_count}")
            values.append(user_update.name)
            param_count += 1

        if user_update.email is not None:
            update_fields.append(f"email = ${param_count}")
            values.append(user_update.email)
            param_count += 1

        if user_update.age is not None:
            update_fields.append(f"age = ${param_count}")
            values.append(user_update.age)
            param_count += 1

        if not update_fields:
            raise HTTPException(status_code=400, detail="No fields to update")

        values.append(user_id)
        query = f"UPDATE users SET {', '.join(update_fields)} WHERE id = ${param_count} RETURNING *"

        row = await conn.fetchrow(query, *values)
        return User(
            id=row['id'],
            name=row['name'],
            email=row['email'],
            age=row['age'],
            created_at=row['created_at'].isoformat()
        )
    except asyncpg.UniqueViolationError:
        raise HTTPException(status_code=400, detail="Email already exists")
    finally:
        await conn.close()

@app.delete("/users/{user_id}")
@tracer.wrap("user_service.delete_user")
async def delete_user(user_id: int):
    """Delete user by ID"""
    conn = await get_db_connection()
    try:
        result = await conn.execute("DELETE FROM users WHERE id = $1", user_id)
        if result == "DELETE 0":
            raise HTTPException(status_code=404, detail="User not found")

        return {"message": "User deleted successfully"}
    finally:
        await conn.close()

@app.get("/")
async def root():
    """Root endpoint with service information"""
    return {
        "service": "user-service",
        "version": "1.0.0",
        "status": "running",
        "endpoints": {
            "health": "/health",
            "users": "/users",
            "docs": "/docs"
        }
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
