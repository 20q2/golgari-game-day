import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDialogModule, MatDialog } from '@angular/material/dialog';
import { GooglePhotosSetupComponent } from '../components/google-photos-setup/google-photos-setup.component';
import { MatChipsModule } from '@angular/material/chips';
import { MatGridListModule } from '@angular/material/grid-list';
import { Observable } from 'rxjs';
import { PhotosService } from '../services/photos.service';
import { SimplePhotosService } from '../services/simple-photos.service';
import { Photo } from '../models/photo.model';

@Component({
  selector: 'app-photos',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatDialogModule,
    MatChipsModule,
    MatGridListModule
  ],
  templateUrl: './photos.component.html',
  styleUrls: ['./photos.component.scss']
})
export class PhotosComponent implements OnInit, OnDestroy {
  photos$: Observable<Photo[]>;
  googlePhotosLink: string;

  constructor(
    private photosService: PhotosService,
    private simplePhotosService: SimplePhotosService,
    private dialog: MatDialog
  ) {
    this.photos$ = this.photosService.getPhotos();
    this.googlePhotosLink = this.photosService.getGooglePhotosLink();
  }

  ngOnInit(): void {
    document.body.className = 'photos-page';
  }

  ngOnDestroy(): void {
    document.body.className = '';
  }

  isLoading = false;

  openGooglePhotos(): void {
    window.open(this.googlePhotosLink, '_blank');
  }

  // Super easy Google Photos sync - just one click!
  async syncGooglePhotos(): Promise<void> {
    console.log('🔄 Starting Google Photos sync...');
    this.isLoading = true;
    
    try {
      console.log('📡 Calling syncWithGooglePhotos...');
      await this.photosService.syncWithGooglePhotos();
      console.log('✅ Google Photos synced successfully!');
      alert('✅ Google Photos synced! Check your photos below.');
    } catch (error) {
      console.error('❌ Failed to sync Google Photos:', error);
      alert(`❌ Sync failed: ${(error as Error)?.message || 'Unknown error'}\n\nCheck console (F12) for details.`);
    }
    
    this.isLoading = false;
    console.log('🏁 Sync process completed');
  }

  openPhotoDialog(photo: Photo): void {
    // TODO: Implement photo detail dialog
    console.log('Opening photo:', photo.caption);
  }

  // Open the super easy setup wizard
  openSetupWizard(): void {
    const dialogRef = this.dialog.open(GooglePhotosSetupComponent, {
      width: '700px',
      height: '600px',
      disableClose: false
    });

    dialogRef.afterClosed().subscribe(result => {
      if (result === 'success') {
        console.log('🎉 Setup completed! You can now sync Google Photos.');
      }
    });
  }

  // SUPER SIMPLE alternative - just switch to simple service
  useSuperSimpleMode(): void {
    this.photos$ = this.simplePhotosService.getPhotos();
    alert('🎯 Switched to SUPER SIMPLE mode!\n\nNow edit src/app/services/simple-photos.service.ts and paste your Google Photos URLs directly in the code.\n\nNo API, no auth, no bullshit - just works!');
  }

  uploadPhoto(): void {
    // TODO: Implement photo upload dialog
    console.log('Upload photo functionality');
  }

  trackByPhotoId(index: number, photo: Photo): string {
    return photo.id;
  }
}
