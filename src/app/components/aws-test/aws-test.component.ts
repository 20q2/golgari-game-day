import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { AwsApiService } from '../../services/aws-api.service';

@Component({
  selector: 'app-aws-test',
  standalone: true,
  imports: [CommonModule, MatButtonModule, MatCardModule, MatIconModule],
  template: `
    <mat-card class="test-card">
      <mat-card-header>
        <mat-icon mat-card-avatar>cloud</mat-icon>
        <mat-card-title>🧪 AWS Backend Test</mat-card-title>
        <mat-card-subtitle>Test your AWS integration</mat-card-subtitle>
      </mat-card-header>
      <mat-card-content>
        <div class="test-results">
          <div class="test-item" [class.success]="testResults.connection" [class.error]="testResults.connection === false">
            <mat-icon>{{ testResults.connection === null ? 'sync' : testResults.connection ? 'check_circle' : 'error' }}</mat-icon>
            <span>API Connection: {{ getStatusText(testResults.connection) }}</span>
          </div>
          
          <div class="test-item" [class.success]="testResults.comment" [class.error]="testResults.comment === false">
            <mat-icon>{{ testResults.comment === null ? 'sync' : testResults.comment ? 'check_circle' : 'error' }}</mat-icon>
            <span>Add Comment: {{ getStatusText(testResults.comment) }}</span>
          </div>
          
          <div class="test-item" [class.success]="testResults.rating" [class.error]="testResults.rating === false">
            <mat-icon>{{ testResults.rating === null ? 'sync' : testResults.rating ? 'check_circle' : 'error' }}</mat-icon>
            <span>Add Rating: {{ getStatusText(testResults.rating) }}</span>
          </div>
        </div>
        
        <div class="user-info" *ngIf="userId">
          <p><strong>Your User ID:</strong> {{ userId }}</p>
          <p><strong>Your Username:</strong> {{ username }}</p>
        </div>
      </mat-card-content>
      <mat-card-actions>
        <button mat-raised-button color="primary" (click)="runTests()" [disabled]="isRunning">
          <mat-icon>{{ isRunning ? 'sync' : 'play_arrow' }}</mat-icon>
          {{ isRunning ? 'Testing...' : 'Run All Tests' }}
        </button>
        <button mat-raised-button color="accent" (click)="testIndividual('gloomhaven')" [disabled]="isRunning">
          <mat-icon>message</mat-icon>
          Quick Comment Test
        </button>
      </mat-card-actions>
    </mat-card>
  `,
  styles: [`
    .test-card {
      max-width: 500px;
      margin: 20px auto;
    }
    
    .test-results {
      margin: 20px 0;
    }
    
    .test-item {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px;
      margin: 5px 0;
      border-radius: 5px;
      background-color: #f5f5f5;
      
      &.success {
        background-color: #d4edda;
        color: #155724;
        
        mat-icon {
          color: #28a745;
        }
      }
      
      &.error {
        background-color: #f8d7da;
        color: #721c24;
        
        mat-icon {
          color: #dc3545;
        }
      }
    }
    
    .user-info {
      background-color: #e3f2fd;
      padding: 15px;
      border-radius: 5px;
      margin: 15px 0;
      
      p {
        margin: 5px 0;
        font-family: monospace;
      }
    }
  `]
})
export class AwsTestComponent implements OnInit {
  testResults = {
    connection: null as boolean | null,
    comment: null as boolean | null,
    rating: null as boolean | null
  };
  
  isRunning = false;
  userId = '';
  username = '';

  constructor(private awsApi: AwsApiService) {}

  ngOnInit(): void {
    this.userId = this.awsApi.generateUserId();
    this.username = this.awsApi.getUserName();
  }

  async runTests(): Promise<void> {
    this.isRunning = true;
    this.resetResults();
    
    try {
      // Test 1: Basic API connection
      console.log('🧪 Testing API connection...');
      this.testResults.connection = await this.awsApi.testApi();
      
      // Test 2: Add a comment
      console.log('🧪 Testing comment creation...');
      try {
        await this.awsApi.addComment('test-game', {
          userId: this.userId,
          username: this.username,
          comment: `Test comment from ${this.username} at ${new Date().toLocaleTimeString()}`
        });
        this.testResults.comment = true;
      } catch (error) {
        this.testResults.comment = false;
        console.error('Comment test failed:', error);
      }
      
      // Test 3: Add a rating
      console.log('🧪 Testing rating creation...');
      try {
        await this.awsApi.addRating('test-game', {
          userId: this.userId,
          username: this.username,
          rating: Math.floor(Math.random() * 10) + 1
        });
        this.testResults.rating = true;
      } catch (error) {
        this.testResults.rating = false;
        console.error('Rating test failed:', error);
      }
      
      console.log('🎉 All tests completed!');
    } catch (error) {
      console.error('Test suite failed:', error);
    } finally {
      this.isRunning = false;
    }
  }

  async testIndividual(gameId: string): Promise<void> {
    try {
      const result = await this.awsApi.addComment(gameId, {
        userId: this.userId,
        username: this.username,
        comment: `Quick test: ${new Date().toLocaleString()}`
      });
      console.log('✅ Quick test successful:', result);
      alert('✅ Comment added successfully to ' + gameId);
    } catch (error) {
      console.error('❌ Quick test failed:', error);
      alert('❌ Quick test failed: ' + (error as Error).message);
    }
  }

  getStatusText(status: boolean | null): string {
    if (status === null) return 'Pending...';
    return status ? 'Success ✅' : 'Failed ❌';
  }

  private resetResults(): void {
    this.testResults = {
      connection: null,
      comment: null,
      rating: null
    };
  }
}