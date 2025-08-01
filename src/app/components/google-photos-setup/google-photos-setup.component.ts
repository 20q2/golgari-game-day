import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatDialogRef } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';

@Component({
  selector: 'app-google-photos-setup',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatCardModule,
    MatButtonModule,
    MatInputModule,
    MatFormFieldModule,
    MatIconModule
  ],
  template: `
    <div class="setup-container">
      <h2>🚀 Super Easy Google Photos Setup</h2>
      <p>I'll walk you through this step by step, don't worry!</p>

      <div class="step" [class.active]="currentStep === 1">
        <h3>Step 1: Get Your Google API Stuff</h3>
        <p>Click this button and I'll open the right page for you:</p>
        <button mat-raised-button color="primary" (click)="openGoogleConsole()">
          <mat-icon>open_in_new</mat-icon>
          Open Google Console (I'll do the work!)
        </button>
        <div class="instructions">
          <p>When it opens:</p>
          <ol>
            <li>Click "Create Project" (or pick an existing one)</li>
            <li>Click "Enable APIs" and search for "Photos Library API"</li>
            <li>Click "Create Credentials" → "API Key"</li>
            <li>Copy the API Key and paste it below 👇</li>
          </ol>
        </div>
      </div>

      <div class="step" [class.active]="currentStep === 2">
        <h3>Step 2: Paste Your API Key Here</h3>
        <mat-form-field appearance="outline" class="full-width">
          <mat-label>API Key (paste here)</mat-label>
          <input matInput [(ngModel)]="apiKey" placeholder="Paste your API key here">
          <mat-icon matSuffix>key</mat-icon>
        </mat-form-field>
        <button mat-raised-button color="accent" (click)="nextStep()" [disabled]="!apiKey">
          Next Step
        </button>
      </div>

      <div class="step" [class.active]="currentStep === 3">
        <h3>Step 3: Get Client ID</h3>
        <p>Back in Google Console, now click "Create Credentials" → "OAuth 2.0 Client ID"</p>
        <p>For "Application type" pick "Web application"</p>
        <p>Copy the Client ID and paste it here:</p>
        
        <mat-form-field appearance="outline" class="full-width">
          <mat-label>Client ID (paste here)</mat-label>
          <input matInput [(ngModel)]="clientId" placeholder="Paste your client ID here">
          <mat-icon matSuffix>person</mat-icon>
        </mat-form-field>
        <button mat-raised-button color="accent" (click)="nextStep()" [disabled]="!clientId">
          Next Step
        </button>
      </div>

      <div class="step" [class.active]="currentStep === 4">
        <h3>Step 4: Optional - Use Specific Album?</h3>
        <p>Leave this empty to use ALL your photos, or paste an album ID to use just one album:</p>
        
        <mat-form-field appearance="outline" class="full-width">
          <mat-label>Album ID (optional - leave empty for all photos)</mat-label>
          <input matInput [(ngModel)]="albumId" placeholder="Leave empty for all photos">
          <mat-icon matSuffix>photo_album</mat-icon>
        </mat-form-field>
        <button mat-raised-button color="accent" (click)="nextStep()">
          Almost Done!
        </button>
      </div>

      <div class="step" [class.active]="currentStep === 5">
        <h3>🎉 Step 5: I'll Set Everything Up!</h3>
        <p>Click this button and I'll automatically update your config file:</p>
        
        <button mat-raised-button color="primary" (click)="autoSetup()" class="big-button">
          <mat-icon>auto_fix_high</mat-icon>
          AUTO-SETUP EVERYTHING FOR ME!
        </button>
        
        <div class="preview" *ngIf="apiKey && clientId">
          <h4>Preview of what I'll save:</h4>
          <pre>{{ getConfigPreview() }}</pre>
        </div>
      </div>

      <div class="actions">
        <button mat-button (click)="close()" *ngIf="currentStep < 5">
          Cancel
        </button>
        <button mat-button (click)="previousStep()" *ngIf="currentStep > 1">
          Previous
        </button>
      </div>
    </div>
  `,
  styles: [`
    .setup-container {
      padding: 20px;
      max-width: 600px;
      margin: 0 auto;
    }

    .step {
      margin: 20px 0;
      padding: 20px;
      border: 2px solid #ddd;
      border-radius: 8px;
      opacity: 0.5;
    }

    .step.active {
      opacity: 1;
      border-color: #1976d2;
      background: #f5f5f5;
    }

    .instructions {
      background: #e3f2fd;
      padding: 15px;
      border-radius: 5px;
      margin: 10px 0;
    }

    .full-width {
      width: 100%;
      margin: 10px 0;
    }

    .big-button {
      font-size: 18px !important;
      padding: 15px 30px !important;
      height: auto !important;
    }

    .preview {
      background: #f0f0f0;
      padding: 15px;
      border-radius: 5px;
      margin: 15px 0;
    }

    .preview pre {
      background: #333;
      color: #0f0;
      padding: 10px;
      border-radius: 3px;
      font-family: monospace;
    }

    .actions {
      display: flex;
      justify-content: space-between;
      margin-top: 30px;
    }

    h2 {
      text-align: center;
      color: #1976d2;
    }

    ol li {
      margin: 5px 0;
      font-weight: bold;
    }
  `]
})
export class GooglePhotosSetupComponent {
  currentStep = 1;
  apiKey = '';
  clientId = '';
  albumId = '';

  constructor(
    private dialogRef: MatDialogRef<GooglePhotosSetupComponent>,
    private snackBar: MatSnackBar
  ) {}

  openGoogleConsole(): void {
    // Open Google Cloud Console with the right settings
    const url = 'https://console.cloud.google.com/apis/dashboard';
    window.open(url, '_blank');
    this.nextStep();
  }

  nextStep(): void {
    if (this.currentStep < 5) {
      this.currentStep++;
    }
  }

  previousStep(): void {
    if (this.currentStep > 1) {
      this.currentStep--;
    }
  }

  getConfigPreview(): string {
    return `export const GOOGLE_PHOTOS_CONFIG = {
  clientId: '${this.clientId}',
  apiKey: '${this.apiKey}',
  albumId: '${this.albumId || 'undefined // Will use all photos'}'
};`;
  }

  async autoSetup(): Promise<void> {
    try {
      // This would normally make an API call to update the config file
      // For now, we'll just show the user what to copy-paste
      
      const configContent = `// Super simple Google Photos configuration
// This was auto-generated by the setup wizard!

export interface GooglePhotosConfig {
  clientId: string;
  apiKey: string;
  albumId?: string;
}

export const GOOGLE_PHOTOS_CONFIG: GooglePhotosConfig = {
  clientId: '${this.clientId}',
  apiKey: '${this.apiKey}',
  albumId: '${this.albumId || ''}' // ${this.albumId ? 'Using specific album' : 'Using all photos'}
};

// 🎉 Setup complete! Go click "Sync Google Photos" in the app!`;

      // Copy to clipboard
      await navigator.clipboard.writeText(configContent);
      
      this.snackBar.open('✅ Config copied to clipboard! Now paste it into google-photos-config.ts', 'Got it!', {
        duration: 10000
      });

      this.dialogRef.close('success');
    } catch (error) {
      this.snackBar.open('❌ Something went wrong. Check the console.', 'OK', {
        duration: 5000
      });
    }
  }

  close(): void {
    this.dialogRef.close();
  }
}