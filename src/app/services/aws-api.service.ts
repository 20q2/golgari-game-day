import { Injectable } from '@angular/core';

export interface Comment {
  commentId: string;
  gameId: string;
  userId: string;
  username: string;
  comment: string;
  rating?: number;
  timestamp: string;
}

export interface Rating {
  gameId: string;
  userId: string;
  username: string;
  rating: number;
  timestamp: string;
}

export interface Like {
  gameId: string;
  userId: string;
  username: string;
  timestamp: string;
}

export interface RatingsResponse {
  averageRating: number | null;
  totalRatings: number;
  ratings: Rating[];
}

export interface CommentsResponse {
  comments: Comment[];
}

export interface AllCommentsResponse {
  comments: Comment[];
  totalComments: number;
  lastUpdated: string;
}

export interface AllRatingsResponse {
  ratings: Rating[];
  totalRatings: number;
  lastUpdated: string;
}

export interface LikesResponse {
  totalLikes: number;
  isLikedByCurrentUser: boolean;
  likes: Like[];
}

export interface AllLikesResponse {
  likes: Like[];
  totalLikes: number;
  lastUpdated: string;
}

@Injectable({
  providedIn: 'root'
})
export class AwsApiService {
  private readonly API_BASE_URL = 'https://en53hl67hhzmm5n4ydc26qxeru0doggy.lambda-url.us-east-1.on.aws';

  constructor() {}

  // 💬 COMMENT OPERATIONS
  async getComments(gameId: string): Promise<CommentsResponse> {
    console.log(`🔍 Fetching comments for game: ${gameId}`);
    console.log(`🌐 URL: ${this.API_BASE_URL}/comments/${gameId}`);
    
    try {
      const response = await fetch(`${this.API_BASE_URL}/comments/${gameId}`, {
        method: 'GET',
        mode: 'cors',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      console.log(`📡 Response status: ${response.status} ${response.statusText}`);

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`❌ Response error:`, errorText);
        throw new Error(`Failed to get comments: ${response.status} ${response.statusText} - ${errorText}`);
      }

      const data = await response.json();
      console.log(`✅ Comments data:`, data);
      return data;
    } catch (error) {
      console.error(`💥 Fetch error for comments:`, error);
      if (error instanceof TypeError && error.message.includes('fetch')) {
        throw new Error(`Network error: Cannot reach AWS API. Check your internet connection and API URL.`);
      }
      throw error;
    }
  }

  async addComment(gameId: string, data: {
    userId: string;
    username: string;
    comment: string;
    rating?: number;
  }): Promise<{ message: string; commentId: string }> {
    const response = await fetch(`${this.API_BASE_URL}/comments/${gameId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || `Failed to add comment: ${response.statusText}`);
    }

    return response.json();
  }

  async updateComment(gameId: string, commentId: string, data: {
    comment: string;
    rating?: number;
  }): Promise<{ message: string }> {
    const response = await fetch(`${this.API_BASE_URL}/comments/${gameId}/${commentId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || `Failed to update comment: ${response.statusText}`);
    }

    return response.json();
  }

  async deleteComment(gameId: string, commentId: string): Promise<{ message: string }> {
    const response = await fetch(`${this.API_BASE_URL}/comments/${gameId}/${commentId}`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || `Failed to delete comment: ${response.statusText}`);
    }

    return response.json();
  }

  // ⭐ RATING OPERATIONS
  async getRatings(gameId: string): Promise<RatingsResponse> {
    console.log(`🔍 Fetching ratings for game: ${gameId}`);
    console.log(`🌐 URL: ${this.API_BASE_URL}/ratings/${gameId}`);
    
    // First check if we can reach the internet at all
    try {
      console.log('🌍 Testing basic internet connectivity...');
      await fetch('https://www.google.com/favicon.ico', { method: 'HEAD', mode: 'no-cors' });
      console.log('✅ Internet connectivity confirmed');
    } catch (connectError) {
      console.error('❌ No internet connectivity:', connectError);
      throw new Error('No internet connection detected. Please check your network.');
    }
    
    try {
      console.log('🚀 Making AWS API request...');
      const response = await fetch(`${this.API_BASE_URL}/ratings/${gameId}`, {
        method: 'GET',
        mode: 'cors',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      console.log(`📡 Response status: ${response.status} ${response.statusText}`);
      console.log(`📡 Response headers:`, response.headers);

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`❌ Response error:`, errorText);
        throw new Error(`Failed to get ratings: ${response.status} ${response.statusText} - ${errorText}`);
      }

      const data = await response.json();
      console.log(`✅ Ratings data:`, data);
      return data;
    } catch (error) {
      console.error(`💥 Fetch error for ratings:`, error);
      if (error instanceof TypeError && error.message.includes('fetch')) {
        throw new Error(`Network error: Cannot reach AWS API. Check your internet connection and API URL.`);
      }
      throw error;
    }
  }

  async addRating(gameId: string, data: {
    userId: string;
    username: string;
    rating: number;
  }): Promise<{ message: string }> {
    const response = await fetch(`${this.API_BASE_URL}/ratings/${gameId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || `Failed to add rating: ${response.statusText}`);
    }

    return response.json();
  }

  // ❤️ LIKE OPERATIONS
  async getLikes(gameId: string): Promise<LikesResponse> {
    console.log(`🔍 Fetching likes for game: ${gameId}`);
    
    try {
      const response = await fetch(`${this.API_BASE_URL}/likes/${gameId}?userId=${this.generateUserId()}`, {
        method: 'GET',
        mode: 'cors',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      console.log(`📡 Likes response status: ${response.status} ${response.statusText}`);

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`❌ Likes error:`, errorText);
        throw new Error(`Failed to get likes: ${response.status} ${response.statusText} - ${errorText}`);
      }

      const data = await response.json();
      console.log(`✅ Likes data:`, data);
      return data;
    } catch (error) {
      console.error(`💥 Fetch error for likes:`, error);
      if (error instanceof TypeError && error.message.includes('fetch')) {
        throw new Error(`Network error: Cannot reach AWS API. Check your internet connection and API URL.`);
      }
      throw error;
    }
  }

  async toggleLike(gameId: string): Promise<{ message: string; isLiked: boolean }> {
    console.log(`❤️ Toggling like for game: ${gameId}`);
    
    try {
      const response = await fetch(`${this.API_BASE_URL}/likes/${gameId}`, {
        method: 'POST',
        mode: 'cors',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userId: this.generateUserId(),
          username: this.getUserName()
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || `Failed to toggle like: ${response.statusText}`);
      }

      const result = await response.json();
      console.log(`✅ Like toggled:`, result);
      return result;
    } catch (error) {
      console.error(`💥 Toggle like error:`, error);
      throw error;
    }
  }

  // 📊 BULK DATA OPERATIONS
  async getAllComments(): Promise<AllCommentsResponse> {
    console.log('🔍 Fetching all comments from database...');
    
    try {
      const response = await fetch(`${this.API_BASE_URL}/all-comments`, {
        method: 'GET',
        mode: 'cors',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      console.log(`📡 Bulk comments response status: ${response.status} ${response.statusText}`);

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`❌ Bulk comments error:`, errorText);
        throw new Error(`Failed to get all comments: ${response.status} ${response.statusText} - ${errorText}`);
      }

      const data = await response.json();
      console.log(`✅ Loaded ${data.totalComments} comments from database`);
      return data;
    } catch (error) {
      console.error(`💥 Fetch error for all comments:`, error);
      if (error instanceof TypeError && error.message.includes('fetch')) {
        throw new Error(`Network error: Cannot reach AWS API. Check your internet connection and API URL.`);
      }
      throw error;
    }
  }

  async getAllRatings(): Promise<AllRatingsResponse> {
    console.log('🔍 Fetching all ratings from database...');
    
    try {
      const response = await fetch(`${this.API_BASE_URL}/all-ratings`, {
        method: 'GET',
        mode: 'cors',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      console.log(`📡 Bulk ratings response status: ${response.status} ${response.statusText}`);

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`❌ Bulk ratings error:`, errorText);
        throw new Error(`Failed to get all ratings: ${response.status} ${response.statusText} - ${errorText}`);
      }

      const data = await response.json();
      console.log(`✅ Loaded ${data.totalRatings} ratings from database`);
      return data;
    } catch (error) {
      console.error(`💥 Fetch error for all ratings:`, error);
      if (error instanceof TypeError && error.message.includes('fetch')) {
        throw new Error(`Network error: Cannot reach AWS API. Check your internet connection and API URL.`);
      }
      throw error;
    }
  }

  async getAllLikes(): Promise<AllLikesResponse> {
    console.log('🔍 Fetching all likes from database...');
    
    try {
      const response = await fetch(`${this.API_BASE_URL}/all-likes?userId=${this.generateUserId()}`, {
        method: 'GET',
        mode: 'cors',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      console.log(`📡 Bulk likes response status: ${response.status} ${response.statusText}`);

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`❌ Bulk likes error:`, errorText);
        throw new Error(`Failed to get all likes: ${response.status} ${response.statusText} - ${errorText}`);
      }

      const data = await response.json();
      console.log(`✅ Loaded ${data.totalLikes} likes from database`);
      return data;
    } catch (error) {
      console.error(`💥 Fetch error for all likes:`, error);
      if (error instanceof TypeError && error.message.includes('fetch')) {
        throw new Error(`Network error: Cannot reach AWS API. Check your internet connection and API URL.`);
      }
      throw error;
    }
  }

  // 🔧 UTILITY METHODS
  generateUserId(): string {
    // Simple user ID generation - in real app you'd use proper auth
    let userId = localStorage.getItem('gameday-user-id');
    if (!userId) {
      userId = 'user-' + Math.random().toString(36).substr(2, 9);
      localStorage.setItem('gameday-user-id', userId);
    }
    return userId;
  }

  getUserName(): string {
    // Simple username - in real app you'd use proper auth
    let username = localStorage.getItem('gameday-username');
    if (!username) {
      const randomNames = ['GameMaster', 'BoardGameFan', 'DiceRoller', 'CardShark', 'MeepleCollector'];
      username = randomNames[Math.floor(Math.random() * randomNames.length)] + Math.floor(Math.random() * 1000);
      localStorage.setItem('gameday-username', username);
    }
    return username;
  }

  // For easy testing
  async testApi(): Promise<boolean> {
    console.log('🧪 Testing API connection...');
    try {
      await this.getComments('test-game');
      console.log('✅ API test passed!');
      return true;
    } catch (error) {
      console.error('❌ API test failed:', error);
      return false;
    }
  }

  // Quick manual test - call this from browser console
  async manualTest(): Promise<void> {
    console.log('🔧 Running comprehensive manual API test...');
    console.log('🌐 API Base URL:', this.API_BASE_URL);
    
    // Test 1: Basic internet connectivity
    console.log('\n🌍 Step 1: Testing basic internet connectivity...');
    try {
      await fetch('https://www.google.com/favicon.ico', { method: 'HEAD', mode: 'no-cors' });
      console.log('✅ Internet connectivity confirmed');
    } catch (error) {
      console.error('❌ No internet connection:', error);
      return;
    }
    
    // Test 2: DNS resolution for AWS domain
    console.log('\n🔍 Step 2: Testing DNS resolution...');
    try {
      await fetch('https://en53hl67hhzmm5n4ydc26qxeru0doggy.lambda-url.us-east-1.on.aws', { 
        method: 'HEAD', 
        mode: 'no-cors' 
      });
      console.log('✅ AWS domain is reachable');
    } catch (error) {
      console.error('❌ Cannot reach AWS domain:', error);
    }
    
    // Test 3: Full API test with CORS
    console.log('\n🎯 Step 3: Testing full API with CORS...');
    try {
      const testUrl = `${this.API_BASE_URL}/comments/test-game`;
      console.log('🎯 Testing URL:', testUrl);
      
      const response = await fetch(testUrl, {
        method: 'GET',
        mode: 'cors',
        headers: {
          'Content-Type': 'application/json',
        },
      });
      
      console.log('📊 Response:', {
        status: response.status,
        statusText: response.statusText,
        headers: Object.fromEntries(response.headers.entries()),
        ok: response.ok,
        url: response.url,
        type: response.type
      });
      
      if (response.ok) {
        const data = await response.json();
        console.log('📄 Response Data:', data);
        console.log('🎉 Full API test PASSED!');
      } else {
        const errorText = await response.text();
        console.log('💥 Error Response:', errorText);
      }
    } catch (error) {
      console.error('🚨 Full API test failed:', error);
      console.error('Error details:', {
        name: (error as any)?.name || 'Unknown',
        message: (error as any)?.message || 'Unknown error',
        stack: (error as any)?.stack || 'No stack trace'
      });
    }
  }
}