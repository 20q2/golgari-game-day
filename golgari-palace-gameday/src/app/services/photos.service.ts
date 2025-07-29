import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { Photo, PhotoAlbum } from '../models/photo.model';

@Injectable({
  providedIn: 'root'
})
export class PhotosService {
  private mockPhotos: Photo[] = [
    {
      id: '1',
      url: 'https://images.unsplash.com/photo-1606092195730-5d7b9af1efc5?w=800&q=80',
      thumbnailUrl: 'https://images.unsplash.com/photo-1606092195730-5d7b9af1efc5?w=300&q=80',
      caption: 'Epic Gloomhaven session in progress!',
      uploadedBy: 'Alice',
      timestamp: new Date('2024-01-15'),
      tags: ['gloomhaven', 'strategy', 'epic']
    },
    {
      id: '2',
      url: 'https://images.unsplash.com/photo-1611891487122-207579d67d98?w=800&q=80',
      thumbnailUrl: 'https://images.unsplash.com/photo-1611891487122-207579d67d98?w=300&q=80',
      caption: 'Wingspan board showing beautiful bird cards',
      uploadedBy: 'Bob',
      timestamp: new Date('2024-01-10'),
      tags: ['wingspan', 'birds', 'beautiful']
    },
    {
      id: '3',
      url: 'https://images.unsplash.com/photo-1566694271453-390536dd1f0d?w=800&q=80',
      thumbnailUrl: 'https://images.unsplash.com/photo-1566694271453-390536dd1f0d?w=300&q=80',
      caption: 'Game night setup with snacks and drinks',
      uploadedBy: 'Charlie',
      timestamp: new Date('2024-01-08'),
      tags: ['setup', 'snacks', 'gamenight']
    },
    {
      id: '4',
      url: 'https://images.unsplash.com/photo-1578662996442-48f60103fc96?w=800&q=80',
      thumbnailUrl: 'https://images.unsplash.com/photo-1578662996442-48f60103fc96?w=300&q=80',
      caption: 'Intense Pandemic cooperation moment',
      uploadedBy: 'Diana',
      timestamp: new Date('2024-01-05'),
      tags: ['pandemic', 'cooperation', 'intense']
    },
    {
      id: '5',
      url: 'https://images.unsplash.com/photo-1606092195624-c68019de0e6e?w=800&q=80',
      thumbnailUrl: 'https://images.unsplash.com/photo-1606092195624-c68019de0e6e?w=300&q=80',
      caption: 'Victory celebration after beating Azul!',
      uploadedBy: 'Eve',
      timestamp: new Date('2024-01-03'),
      tags: ['azul', 'victory', 'celebration']
    },
    {
      id: '6',
      url: 'https://images.unsplash.com/photo-1609891488375-2acd6bf36b45?w=800&q=80',
      thumbnailUrl: 'https://images.unsplash.com/photo-1609891488375-2acd6bf36b45?w=300&q=80',
      caption: 'Codenames team strategizing',
      uploadedBy: 'Frank',
      timestamp: new Date('2024-01-01'),
      tags: ['codenames', 'team', 'strategy']
    }
  ];

  private photosSubject = new BehaviorSubject<Photo[]>(this.mockPhotos);

  constructor() { }

  getPhotos(): Observable<Photo[]> {
    return this.photosSubject.asObservable();
  }

  uploadPhoto(photo: Omit<Photo, 'id' | 'timestamp'>): void {
    const newPhoto: Photo = {
      ...photo,
      id: Date.now().toString(),
      timestamp: new Date()
    };
    
    const currentPhotos = this.photosSubject.value;
    this.photosSubject.next([newPhoto, ...currentPhotos]);
  }

  // Simulate Google Photos integration
  getGooglePhotosLink(): string {
    return 'https://photos.google.com/share/your-album-link-here';
  }

  // Mock method for future Google Photos API integration
  async uploadToGooglePhotos(file: File): Promise<string> {
    // In a real implementation, this would use the Google Photos API
    return new Promise((resolve) => {
      setTimeout(() => {
        // Return a mock URL
        resolve(`https://lh3.googleusercontent.com/mock-${Date.now()}`);
      }, 2000);
    });
  }
}
