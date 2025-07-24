from flask import Flask, request, jsonify
import psycopg2
import psycopg2.extras
import os
import logging
import time
from ddtrace import tracer
from contextlib import contextmanager

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = Flask(__name__)

# Database connection
def get_db_connection():
    """Get database connection"""
    database_url = os.getenv('DATABASE_URL')
    database_password = os.getenv('DATABASE_PASSWORD')

    # For demo purposes, construct connection string
    # In production, use proper secret management
    connection_string = f"postgresql://postgres:{database_password}@{database_url}:5432/microservices"

    try:
        conn = psycopg2.connect(connection_string)
        conn.autocommit = True
        return conn
    except Exception as e:
        logger.error(f"Database connection failed: {e}")
        raise Exception("Database unavailable")

@contextmanager
def get_db():
    """Context manager for database connections"""
    conn = None
    try:
        conn = get_db_connection()
        yield conn
    finally:
        if conn:
            conn.close()

def init_db():
    """Initialize database tables"""
    try:
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS orders (
                    id SERIAL PRIMARY KEY,
                    user_id INTEGER NOT NULL,
                    product VARCHAR(255) NOT NULL,
                    quantity INTEGER NOT NULL DEFAULT 1,
                    price DECIMAL(10, 2) NOT NULL,
                    status VARCHAR(50) DEFAULT 'pending',
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
        logger.info("Database initialized successfully")
    except Exception as e:
        logger.error(f"Database initialization failed: {e}")

# Initialize database on startup
init_db()

@app.route('/health', methods=['GET'])
def health():
    """Health check endpoint"""
    return jsonify({
        'status': 'healthy',
        'service': 'order-service',
        'timestamp': int(time.time())
    }), 200

@app.route('/orders', methods=['GET'])
@tracer.wrap('order_service.get_orders')
def get_orders():
    """Get all orders"""
    try:
        with get_db() as conn:
            cursor = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
            cursor.execute("SELECT * FROM orders ORDER BY id DESC")
            orders = cursor.fetchall()

            # Convert to JSON serializable format
            result = []
            for order in orders:
                result.append({
                    'id': order['id'],
                    'user_id': order['user_id'],
                    'product': order['product'],
                    'quantity': order['quantity'],
                    'price': float(order['price']),
                    'status': order['status'],
                    'created_at': order['created_at'].isoformat()
                })

            return jsonify(result), 200
    except Exception as e:
        logger.error(f"Error fetching orders: {e}")
        return jsonify({'error': 'Database error'}), 500

@app.route('/orders', methods=['POST'])
@tracer.wrap('order_service.create_order')
def create_order():
    """Create a new order"""
    try:
        data = request.get_json()

        # Validate required fields
        required_fields = ['user_id', 'product', 'price']
        for field in required_fields:
            if field not in data:
                return jsonify({'error': f'Missing required field: {field}'}), 400

        user_id = data['user_id']
        product = data['product']
        quantity = data.get('quantity', 1)
        price = data['price']
        status = data.get('status', 'pending')

        with get_db() as conn:
            cursor = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
            cursor.execute("""
                INSERT INTO orders (user_id, product, quantity, price, status)
                VALUES (%s, %s, %s, %s, %s)
                RETURNING *
            """, (user_id, product, quantity, price, status))

            order = cursor.fetchone()

            result = {
                'id': order['id'],
                'user_id': order['user_id'],
                'product': order['product'],
                'quantity': order['quantity'],
                'price': float(order['price']),
                'status': order['status'],
                'created_at': order['created_at'].isoformat()
            }

            return jsonify(result), 201
    except Exception as e:
        logger.error(f"Error creating order: {e}")
        return jsonify({'error': 'Database error'}), 500

@app.route('/orders/<int:order_id>', methods=['GET'])
@tracer.wrap('order_service.get_order')
def get_order(order_id):
    """Get order by ID"""
    try:
        with get_db() as conn:
            cursor = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
            cursor.execute("SELECT * FROM orders WHERE id = %s", (order_id,))
            order = cursor.fetchone()

            if not order:
                return jsonify({'error': 'Order not found'}), 404

            result = {
                'id': order['id'],
                'user_id': order['user_id'],
                'product': order['product'],
                'quantity': order['quantity'],
                'price': float(order['price']),
                'status': order['status'],
                'created_at': order['created_at'].isoformat()
            }

            return jsonify(result), 200
    except Exception as e:
        logger.error(f"Error fetching order: {e}")
        return jsonify({'error': 'Database error'}), 500

@app.route('/orders/<int:order_id>', methods=['PUT'])
@tracer.wrap('order_service.update_order')
def update_order(order_id):
    """Update order by ID"""
    try:
        data = request.get_json()

        with get_db() as conn:
            cursor = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

            # Check if order exists
            cursor.execute("SELECT * FROM orders WHERE id = %s", (order_id,))
            if not cursor.fetchone():
                return jsonify({'error': 'Order not found'}), 404

            # Build dynamic update query
            update_fields = []
            values = []

            if 'product' in data:
                update_fields.append("product = %s")
                values.append(data['product'])

            if 'quantity' in data:
                update_fields.append("quantity = %s") 
                values.append(data['quantity'])

            if 'price' in data:
                update_fields.append("price = %s")
                values.append(data['price'])

            if 'status' in data:
                update_fields.append("status = %s")
                values.append(data['status'])

            if not update_fields:
                return jsonify({'error': 'No fields to update'}), 400

            values.append(order_id)
            query = f"UPDATE orders SET {', '.join(update_fields)} WHERE id = %s RETURNING *"

            cursor.execute(query, values)
            order = cursor.fetchone()

            result = {
                'id': order['id'],
                'user_id': order['user_id'],
                'product': order['product'],
                'quantity': order['quantity'],
                'price': float(order['price']),
                'status': order['status'],
                'created_at': order['created_at'].isoformat()
            }

            return jsonify(result), 200
    except Exception as e:
        logger.error(f"Error updating order: {e}")
        return jsonify({'error': 'Database error'}), 500

@app.route('/orders/<int:order_id>', methods=['DELETE'])
@tracer.wrap('order_service.delete_order')
def delete_order(order_id):
    """Delete order by ID"""
    try:
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("DELETE FROM orders WHERE id = %s", (order_id,))

            if cursor.rowcount == 0:
                return jsonify({'error': 'Order not found'}), 404

            return jsonify({'message': 'Order deleted successfully'}), 200
    except Exception as e:
        logger.error(f"Error deleting order: {e}")
        return jsonify({'error': 'Database error'}), 500

@app.route('/', methods=['GET'])
def root():
    """Root endpoint with service information"""
    return jsonify({
        'service': 'order-service',
        'version': '1.0.0',
        'status': 'running',
        'endpoints': {
            'health': '/health',
            'orders': '/orders'
        }
    }), 200

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=8000, debug=False)
