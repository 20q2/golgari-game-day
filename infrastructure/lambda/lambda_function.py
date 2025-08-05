import json
import boto3
import os
from datetime import datetime
import base64
from typing import Dict, Any, List, Optional
from decimal import Decimal

# Initialize DynamoDB client
dynamodb = boto3.resource('dynamodb')
table_name = os.environ.get('TABLE_NAME')
user_index_name = os.environ.get('USER_INDEX_NAME')
table = dynamodb.Table(table_name) if table_name else None

# CORS headers for all responses
CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With, Accept, Origin',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS, HEAD',
    'Access-Control-Max-Age': '3600',
    'Content-Type': 'application/json',
    'Cache-Control': 'no-cache',
}

def lambda_handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    🎯 MAIN HANDLER - Routes all requests
    """
    print(f'Event received: {json.dumps(event, default=str, indent=2)}')
    
    try:
        # Handle different event sources (API Gateway vs Function URL)
        http_method = event.get('requestContext', {}).get('http', {}).get('method') or event.get('httpMethod', '')
        raw_path = event.get('requestContext', {}).get('http', {}).get('path') or event.get('rawPath', '')
        
        # Handle body encoding
        body = event.get('body', '')
        if event.get('isBase64Encoded', False) and body:
            body = base64.b64decode(body).decode('utf-8')
        
        query_params = event.get('queryStringParameters') or {}
        
        print(f'Parsed values: method={http_method}, path={raw_path}, body_length={len(body) if body else 0}')
        
        # Parse path parts
        path_parts = [p for p in raw_path.split('/') if p]
        
        # Handle preflight requests
        if http_method == 'OPTIONS':
            return create_response(200, '', CORS_HEADERS)
        
        # Route based on path
        if not path_parts:
            return create_response(404, {'error': 'Endpoint not found'})
        
        endpoint = path_parts[0]
        
        if endpoint == 'comments':
            return handle_comments(http_method, path_parts, body, query_params)
        elif endpoint == 'ratings':
            return handle_ratings(http_method, path_parts, body, query_params)
        elif endpoint == 'likes':
            return handle_likes(http_method, path_parts, body, query_params)
        elif endpoint == 'all-comments':
            return handle_all_comments(http_method)
        elif endpoint == 'all-ratings':
            return handle_all_ratings(http_method)
        elif endpoint == 'all-likes':
            return handle_all_likes(http_method, query_params)
        else:
            return create_response(404, {'error': 'Endpoint not found'})
            
    except Exception as error:
        print(f'Error: {str(error)}')
        return create_response(500, {
            'error': 'Internal server error',
            'message': str(error)
        })

def create_response(status_code: int, body: Any, headers: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
    """Helper function to create standardized responses"""
    response_headers = {**CORS_HEADERS}
    if headers:
        response_headers.update(headers)
    
    if isinstance(body, (dict, list)):
        body = json.dumps(body, default=decimal_default)
    
    return {
        'statusCode': status_code,
        'headers': response_headers,
        'body': body
    }

def decimal_default(obj):
    """JSON serializer for objects not serializable by default json code"""
    if isinstance(obj, Decimal):
        return float(obj)
    raise TypeError(f"Object of type {type(obj)} is not JSON serializable")

# 💬 COMMENTS HANDLER
def handle_comments(method: str, path_parts: List[str], body: str, query_params: Dict[str, Any]) -> Dict[str, Any]:
    """Handle comments endpoints"""
    if len(path_parts) < 2:
        return create_response(400, {'error': 'gameId is required'})
    
    game_id = path_parts[1]
    comment_id = path_parts[2] if len(path_parts) > 2 else None
    
    if method == 'GET':
        return get_comments(game_id)
    elif method == 'POST':
        if not body:
            return create_response(400, {'error': 'Request body is required'})
        try:
            comment_data = json.loads(body)
            return add_comment(game_id, comment_data)
        except json.JSONDecodeError as e:
            return create_response(400, {
                'error': 'Invalid JSON in request body',
                'details': str(e)
            })
    elif method == 'PUT':
        if not comment_id:
            return create_response(400, {'error': 'commentId is required for updates'})
        if not body:
            return create_response(400, {'error': 'Request body is required'})
        try:
            update_data = json.loads(body)
            return update_comment(game_id, comment_id, update_data)
        except json.JSONDecodeError:
            return create_response(400, {'error': 'Invalid JSON in request body'})
    elif method == 'DELETE':
        if not comment_id:
            return create_response(400, {'error': 'commentId is required for deletion'})
        return delete_comment(game_id, comment_id)
    else:
        return create_response(405, {'error': 'Method not allowed'})

# ⭐ RATINGS HANDLER
def handle_ratings(method: str, path_parts: List[str], body: str, query_params: Dict[str, Any]) -> Dict[str, Any]:
    """Handle ratings endpoints"""
    if len(path_parts) < 2:
        return create_response(400, {'error': 'gameId is required'})
    
    game_id = path_parts[1]
    
    if method == 'GET':
        return get_ratings(game_id)
    elif method == 'POST':
        if not body:
            return create_response(400, {'error': 'Request body is required'})
        try:
            rating_data = json.loads(body)
            return add_rating(game_id, rating_data)
        except json.JSONDecodeError:
            return create_response(400, {'error': 'Invalid JSON in request body'})
    else:
        return create_response(405, {'error': 'Method not allowed'})

# ❤️ LIKES HANDLER
def handle_likes(method: str, path_parts: List[str], body: str, query_params: Dict[str, Any]) -> Dict[str, Any]:
    """Handle likes endpoints"""
    if len(path_parts) < 2:
        return create_response(400, {'error': 'gameId is required'})
    
    game_id = path_parts[1]
    
    if method == 'GET':
        user_id = query_params.get('userId')
        return get_likes(game_id, user_id)
    elif method == 'POST':
        if not body:
            return create_response(400, {'error': 'Request body is required'})
        try:
            like_data = json.loads(body)
            return toggle_like(game_id, like_data)
        except json.JSONDecodeError:
            return create_response(400, {'error': 'Invalid JSON in request body'})
    else:
        return create_response(405, {'error': 'Method not allowed'})

# 📊 BULK DATA HANDLERS
def handle_all_comments(method: str) -> Dict[str, Any]:
    """Handle bulk comments endpoint"""
    if method != 'GET':
        return create_response(405, {'error': 'Method not allowed'})
    return get_all_comments()

def handle_all_ratings(method: str) -> Dict[str, Any]:
    """Handle bulk ratings endpoint"""
    if method != 'GET':
        return create_response(405, {'error': 'Method not allowed'})
    return get_all_ratings()

def handle_all_likes(method: str, query_params: Dict[str, Any]) -> Dict[str, Any]:
    """Handle bulk likes endpoint"""
    if method != 'GET':
        return create_response(405, {'error': 'Method not allowed'})
    user_id = query_params.get('userId')
    return get_all_likes(user_id)

# 📝 COMMENT OPERATIONS
def get_comments(game_id: str) -> Dict[str, Any]:
    """Get all comments for a game"""
    try:
        response = table.query(
            KeyConditionExpression='pk = :pk AND begins_with(sk, :sk)',
            ExpressionAttributeValues={
                ':pk': f'GAME#{game_id}',
                ':sk': 'COMMENT#'
            },
            ScanIndexForward=False  # Most recent first
        )
        
        comments = []
        for item in response['Items']:
            comments.append({
                'commentId': item['sk'].replace('COMMENT#', ''),
                'gameId': game_id,
                'userId': item['userId'],
                'username': item['username'],
                'comment': item['comment'],
                'rating': item.get('rating'),
                'timestamp': item['timestamp']
            })
        
        return create_response(200, {'comments': comments})
        
    except Exception as e:
        print(f'Error getting comments: {str(e)}')
        return create_response(500, {'error': 'Failed to get comments', 'message': str(e)})

def add_comment(game_id: str, data: Dict[str, Any]) -> Dict[str, Any]:
    """Add a new comment"""
    # Validate required fields
    if not all(key in data for key in ['userId', 'username', 'comment']):
        return create_response(400, {
            'error': 'Missing required fields: userId, username, and comment are required'
        })
    
    # Validate rating if provided
    if 'rating' in data and data['rating'] is not None:
        if not isinstance(data['rating'], (int, float)) or not (1 <= data['rating'] <= 10):
            return create_response(400, {
                'error': 'Rating must be a number between 1 and 10'
            })
    
    try:
        comment_id = f"{data['userId']}#{int(datetime.now().timestamp() * 1000)}"
        timestamp = datetime.now().isoformat()
        
        table.put_item(
            Item={
                'pk': f'GAME#{game_id}',
                'sk': f'COMMENT#{comment_id}',
                'userId': data['userId'],
                'username': data['username'],
                'comment': data['comment'],
                'rating': data.get('rating'),
                'timestamp': timestamp,
                'type': 'comment'
            }
        )
        
        return create_response(201, {
            'message': 'Comment added successfully',
            'commentId': comment_id
        })
        
    except Exception as e:
        print(f'Error adding comment: {str(e)}')
        return create_response(500, {'error': 'Failed to add comment', 'message': str(e)})

def update_comment(game_id: str, comment_id: str, data: Dict[str, Any]) -> Dict[str, Any]:
    """Update an existing comment"""
    try:
        table.update_item(
            Key={
                'pk': f'GAME#{game_id}',
                'sk': f'COMMENT#{comment_id}'
            },
            UpdateExpression='SET #comment = :comment, #rating = :rating',
            ExpressionAttributeNames={
                '#comment': 'comment',
                '#rating': 'rating'
            },
            ExpressionAttributeValues={
                ':comment': data['comment'],
                ':rating': data.get('rating')
            }
        )
        
        return create_response(200, {'message': 'Comment updated successfully'})
        
    except Exception as e:
        print(f'Error updating comment: {str(e)}')
        return create_response(500, {'error': 'Failed to update comment', 'message': str(e)})

def delete_comment(game_id: str, comment_id: str) -> Dict[str, Any]:
    """Delete a comment"""
    try:
        table.delete_item(
            Key={
                'pk': f'GAME#{game_id}',
                'sk': f'COMMENT#{comment_id}'
            }
        )
        
        return create_response(200, {'message': 'Comment deleted successfully'})
        
    except Exception as e:
        print(f'Error deleting comment: {str(e)}')
        return create_response(500, {'error': 'Failed to delete comment', 'message': str(e)})

# ⭐ RATING OPERATIONS
def get_ratings(game_id: str) -> Dict[str, Any]:
    """Get all ratings for a game"""
    try:
        response = table.query(
            KeyConditionExpression='pk = :pk AND begins_with(sk, :sk)',
            ExpressionAttributeValues={
                ':pk': f'GAME#{game_id}',
                ':sk': 'RATING#'
            }
        )
        
        ratings = [float(item['rating']) for item in response['Items']]
        average_rating = sum(ratings) / len(ratings) if ratings else None
        
        rating_details = []
        for item in response['Items']:
            rating_details.append({
                'userId': item['userId'],
                'username': item['username'],
                'rating': float(item['rating']),
                'timestamp': item['timestamp']
            })
        
        return create_response(200, {
            'averageRating': round(average_rating, 1) if average_rating else None,
            'totalRatings': len(ratings),
            'ratings': rating_details
        })
        
    except Exception as e:
        print(f'Error getting ratings: {str(e)}')
        return create_response(500, {'error': 'Failed to get ratings', 'message': str(e)})

def add_rating(game_id: str, data: Dict[str, Any]) -> Dict[str, Any]:
    """Add a new rating"""
    # Validate required fields
    required_fields = ['userId', 'username', 'rating']
    if not all(key in data for key in required_fields):
        return create_response(400, {
            'error': 'Missing required fields: userId, username, and rating are required'
        })
    
    # Validate rating
    if not isinstance(data['rating'], (int, float)) or not (1 <= data['rating'] <= 10):
        return create_response(400, {
            'error': 'Rating must be a number between 1 and 10'
        })
    
    try:
        timestamp = datetime.now().isoformat()
        
        table.put_item(
            Item={
                'pk': f'GAME#{game_id}',
                'sk': f'RATING#{data["userId"]}',
                'userId': data['userId'],
                'username': data['username'],
                'rating': Decimal(str(data['rating'])),
                'timestamp': timestamp,
                'type': 'rating'
            }
        )
        
        return create_response(201, {'message': 'Rating added successfully'})
        
    except Exception as e:
        print(f'Error adding rating: {str(e)}')
        return create_response(500, {'error': 'Failed to add rating', 'message': str(e)})

# ❤️ LIKE OPERATIONS
def get_likes(game_id: str, current_user_id: Optional[str] = None) -> Dict[str, Any]:
    """Get all likes for a game"""
    try:
        response = table.query(
            KeyConditionExpression='pk = :pk AND begins_with(sk, :sk)',
            ExpressionAttributeValues={
                ':pk': f'GAME#{game_id}',
                ':sk': 'LIKE#'
            }
        )
        
        likes = []
        for item in response['Items']:
            likes.append({
                'userId': item['userId'],
                'username': item['username'],
                'timestamp': item['timestamp']
            })
        
        is_liked_by_current_user = False
        if current_user_id:
            is_liked_by_current_user = any(like['userId'] == current_user_id for like in likes)
        
        return create_response(200, {
            'totalLikes': len(likes),
            'isLikedByCurrentUser': is_liked_by_current_user,
            'likes': likes
        })
        
    except Exception as e:
        print(f'Error getting likes: {str(e)}')
        return create_response(500, {'error': 'Failed to get likes', 'message': str(e)})

def toggle_like(game_id: str, data: Dict[str, Any]) -> Dict[str, Any]:
    """Toggle like status for a game"""
    # Validate required fields
    if not all(key in data for key in ['userId', 'username']):
        return create_response(400, {
            'error': 'Missing required fields: userId and username are required'
        })
    
    try:
        like_key = {
            'pk': f'GAME#{game_id}',
            'sk': f'LIKE#{data["userId"]}'
        }
        
        # Check if like already exists
        try:
            response = table.get_item(Key=like_key)
            like_exists = 'Item' in response
        except Exception:
            like_exists = False
        
        if like_exists:
            # Remove like (unlike)
            table.delete_item(Key=like_key)
            return create_response(200, {
                'message': 'Like removed successfully',
                'isLiked': False
            })
        else:
            # Add like
            timestamp = datetime.now().isoformat()
            table.put_item(
                Item={
                    **like_key,
                    'userId': data['userId'],
                    'username': data['username'],
                    'timestamp': timestamp,
                    'type': 'like'
                }
            )
            return create_response(200, {
                'message': 'Like added successfully',
                'isLiked': True
            })
            
    except Exception as e:
        print(f'Error toggling like: {str(e)}')
        return create_response(500, {'error': 'Failed to toggle like', 'message': str(e)})

# 📊 BULK DATA OPERATIONS
def get_all_comments() -> Dict[str, Any]:
    """Get all comments from all games"""
    try:
        response = table.scan(
            FilterExpression='#type = :type',
            ExpressionAttributeNames={'#type': 'type'},
            ExpressionAttributeValues={':type': 'comment'}
        )
        
        comments = []
        for item in response['Items']:
            comments.append({
                'commentId': item['sk'].replace('COMMENT#', ''),
                'gameId': item['pk'].replace('GAME#', ''),
                'userId': item['userId'],
                'username': item['username'],
                'comment': item['comment'],
                'rating': item.get('rating'),
                'timestamp': item['timestamp']
            })
        
        # Sort by timestamp, most recent first
        comments.sort(key=lambda x: x['timestamp'], reverse=True)
        
        return create_response(200, {
            'comments': comments,
            'totalComments': len(comments),
            'lastUpdated': datetime.now().isoformat()
        })
        
    except Exception as e:
        print(f'Error getting all comments: {str(e)}')
        return create_response(500, {'error': 'Failed to fetch comments', 'message': str(e)})

def get_all_ratings() -> Dict[str, Any]:
    """Get all ratings from all games"""
    try:
        response = table.scan(
            FilterExpression='#type = :type',
            ExpressionAttributeNames={'#type': 'type'},
            ExpressionAttributeValues={':type': 'rating'}
        )
        
        ratings = []
        for item in response['Items']:
            ratings.append({
                'gameId': item['pk'].replace('GAME#', ''),
                'userId': item['userId'],
                'username': item['username'],
                'rating': float(item['rating']),
                'timestamp': item['timestamp']
            })
        
        # Sort by timestamp, most recent first
        ratings.sort(key=lambda x: x['timestamp'], reverse=True)
        
        return create_response(200, {
            'ratings': ratings,
            'totalRatings': len(ratings),
            'lastUpdated': datetime.now().isoformat()
        })
        
    except Exception as e:
        print(f'Error getting all ratings: {str(e)}')
        return create_response(500, {'error': 'Failed to fetch ratings', 'message': str(e)})

def get_all_likes(current_user_id: Optional[str] = None) -> Dict[str, Any]:
    """Get all likes from all games"""
    try:
        response = table.scan(
            FilterExpression='#type = :type',
            ExpressionAttributeNames={'#type': 'type'},
            ExpressionAttributeValues={':type': 'like'}
        )
        
        likes = []
        for item in response['Items']:
            likes.append({
                'gameId': item['pk'].replace('GAME#', ''),
                'userId': item['userId'],
                'username': item['username'],
                'timestamp': item['timestamp'],
                'isCurrentUser': current_user_id == item['userId'] if current_user_id else False
            })
        
        # Sort by timestamp, most recent first
        likes.sort(key=lambda x: x['timestamp'], reverse=True)
        
        return create_response(200, {
            'likes': likes,
            'totalLikes': len(likes),
            'lastUpdated': datetime.now().isoformat()
        })
        
    except Exception as e:
        print(f'Error getting all likes: {str(e)}')
        return create_response(500, {'error': 'Failed to fetch likes', 'message': str(e)})