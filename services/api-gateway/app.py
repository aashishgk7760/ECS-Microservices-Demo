from flask import Flask, request, jsonify
import requests
import os
import logging
from ddtrace import tracer
from ddtrace.ext import http
import time

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = Flask(__name__)

# Service URLs from environment variables
USER_SERVICE_URL = os.getenv('USER_SERVICE_URL', 'http://user-service:8000')
ORDER_SERVICE_URL = os.getenv('ORDER_SERVICE_URL', 'http://order-service:8000')

@app.route('/health', methods=['GET'])
def health():
    """Health check endpoint"""
    return jsonify({
        'status': 'healthy',
        'service': 'api-gateway',
        'timestamp': int(time.time())
    }), 200

@app.route('/api/users', methods=['GET', 'POST'])
@tracer.wrap('api_gateway.users')
def users():
    """Proxy requests to user service"""
    try:
        if request.method == 'GET':
            response = requests.get(f"{USER_SERVICE_URL}/users")
        else:  # POST
            response = requests.post(f"{USER_SERVICE_URL}/users", json=request.json)

        return jsonify(response.json()), response.status_code
    except requests.RequestException as e:
        logger.error(f"Error calling user service: {e}")
        return jsonify({'error': 'User service unavailable'}), 503

@app.route('/api/users/<user_id>', methods=['GET', 'PUT', 'DELETE'])
@tracer.wrap('api_gateway.user_by_id')
def user_by_id(user_id):
    """Proxy requests to user service for specific user"""
    try:
        if request.method == 'GET':
            response = requests.get(f"{USER_SERVICE_URL}/users/{user_id}")
        elif request.method == 'PUT':
            response = requests.put(f"{USER_SERVICE_URL}/users/{user_id}", json=request.json)
        else:  # DELETE
            response = requests.delete(f"{USER_SERVICE_URL}/users/{user_id}")

        return jsonify(response.json()), response.status_code
    except requests.RequestException as e:
        logger.error(f"Error calling user service: {e}")
        return jsonify({'error': 'User service unavailable'}), 503

@app.route('/api/orders', methods=['GET', 'POST'])
@tracer.wrap('api_gateway.orders')
def orders():
    """Proxy requests to order service"""
    try:
        if request.method == 'GET':
            response = requests.get(f"{ORDER_SERVICE_URL}/orders")
        else:  # POST
            response = requests.post(f"{ORDER_SERVICE_URL}/orders", json=request.json)

        return jsonify(response.json()), response.status_code
    except requests.RequestException as e:
        logger.error(f"Error calling order service: {e}")
        return jsonify({'error': 'Order service unavailable'}), 503

@app.route('/api/orders/<order_id>', methods=['GET', 'PUT', 'DELETE'])
@tracer.wrap('api_gateway.order_by_id')
def order_by_id(order_id):
    """Proxy requests to order service for specific order"""
    try:
        if request.method == 'GET':
            response = requests.get(f"{ORDER_SERVICE_URL}/orders/{order_id}")
        elif request.method == 'PUT':
            response = requests.put(f"{ORDER_SERVICE_URL}/orders/{order_id}", json=request.json)
        else:  # DELETE
            response = requests.delete(f"{ORDER_SERVICE_URL}/orders/{order_id}")

        return jsonify(response.json()), response.status_code
    except requests.RequestException as e:
        logger.error(f"Error calling order service: {e}")
        return jsonify({'error': 'Order service unavailable'}), 503

@app.route('/', methods=['GET'])
def root():
    """Root endpoint with service information"""
    return jsonify({
        'service': 'api-gateway',
        'version': '1.0.0',
        'status': 'running',
        'endpoints': {
            'health': '/health',
            'users': '/api/users',
            'orders': '/api/orders'
        }
    }), 200

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=8000, debug=False)
