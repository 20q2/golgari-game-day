import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { Photo } from '../models/photo.model';

@Injectable({
  providedIn: 'root'
})
export class SimplePhotosService {
  private photosSubject = new BehaviorSubject<Photo[]>([]);

  // SUPER SIMPLE: Just paste your Google Photos URLs here!
  // Get them by opening Google Photos, right-clicking photos, and copying image addresses
  private yourPhotos: Photo[] = [
    // {
    //   id: '1',
    //   url: 'PASTE_YOUR_GOOGLE_PHOTO_URL_HERE',
    //   thumbnailUrl: 'PASTE_YOUR_GOOGLE_PHOTO_URL_HERE',
    //   caption: 'Your photo caption',
    //   uploadedBy: 'You',
    //   timestamp: new Date(),
    //   tags: ['game-day']
    // },
    // Add more photos by copying the pattern above
  ];

  constructor() {
    // Start with your photos if you have any, otherwise use mock data
    if (this.yourPhotos.length > 0) {
      this.photosSubject.next(this.yourPhotos);
    } else {
      // Fallback to some nice game photos
      this.photosSubject.next(this.getMockPhotos());
    }
  }

  getPhotos(): Observable<Photo[]> {
    return this.photosSubject.asObservable();
  }

  // Add a photo URL manually (super easy!)
  addPhotoUrl(url: string, caption: string = 'Game Day Photo'): void {
    const newPhoto: Photo = {
      id: Date.now().toString(),
      url: url,
      thumbnailUrl: url,
      caption: caption,
      uploadedBy: 'You',
      timestamp: new Date(),
      tags: ['manual-add']
    };
    
    const currentPhotos = this.photosSubject.value;
    this.photosSubject.next([newPhoto, ...currentPhotos]);
  }

  private getMockPhotos(): Photo[] {
    return [
      {
        id: '1',
        url: 'https://images.unsplash.com/photo-1606092195730-5d7b9af1efc5?w=800&q=80',
        thumbnailUrl: 'https://images.unsplash.com/photo-1606092195730-5d7b9af1efc5?w=300&q=80',
        caption: 'Epic board game session!',
        uploadedBy: 'Game Master',
        timestamp: new Date('2024-01-15'),
        tags: ['epic', 'strategy']
      },
      {
        id: '2',
        url: 'https://images.unsplash.com/photo-1611891487122-207579d67d98?w=800&q=80',
        thumbnailUrl: 'https://images.unsplash.com/photo-1611891487122-207579d67d98?w=300&q=80',
        caption: 'Beautiful game setup',
        uploadedBy: 'Player 1',
        timestamp: new Date('2024-01-10'),
        tags: ['beautiful', 'setup']
      }
    ];
  }

  // SUPER EASY METHOD: Just paste Google Photos share link
  loadFromGooglePhotosShareLink(shareLink: string): void {
    alert(`To use photos from: ${shareLink}\n\n1. Open that link\n2. Right-click each photo\n3. Copy image address\n4. Paste URLs in simple-photos.service.ts\n\nIt's manual but it works 100%!`);
  }
}