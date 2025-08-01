import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, from } from 'rxjs';
import { Photo, PhotoAlbum } from '../models/photo.model';
import { GOOGLE_PHOTOS_CONFIG } from './google-photos-config';

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

  private isGoogleApiLoaded = false;
  private gapi: any;


  // Super simple Google Photos integration!
  async loadGooglePhotos(): Promise<Photo[]> {
    console.log('🚀 Loading Google Photos...');
    console.log('📋 Config:', GOOGLE_PHOTOS_CONFIG);
    
    try {
      console.log('🔧 Initializing Google API...');
      await this.initGoogleApi();
      
      console.log('📸 Fetching photos...');
      const photos = await this.fetchGooglePhotos();
      
      console.log(`📊 Found ${photos.length} photos`);
      
      // Replace mock photos with real ones
      this.photosSubject.next(photos);
      return photos;
    } catch (error) {
      console.error('❌ Google Photos error:', error);
      // Fall back to mock data if Google Photos fails
      console.log('🔄 Falling back to mock data');
      throw error; // Re-throw to show user the actual error
    }
  }

  private async initGoogleApi(): Promise<void> {
    if (this.isGoogleApiLoaded) {
      console.log('✅ Google API already loaded');
      return;
    }

    console.log('📦 Loading Google API script...');
    // Load Google API
    await new Promise<void>((resolve, reject) => {
      if (typeof (window as any).gapi !== 'undefined') {
        console.log('✅ Google API script already exists');
        resolve();
        return;
      }

      const script = document.createElement('script');
      script.src = 'https://apis.google.com/js/api.js';
      script.onload = () => {
        console.log('✅ Google API script loaded');
        resolve();
      };
      script.onerror = () => {
        console.error('❌ Failed to load Google API script');
        reject(new Error('Failed to load Google API'));
      };
      document.head.appendChild(script);
    });

    console.log('🔧 Initializing Google API client...');
    // Initialize
    await new Promise<void>((resolve, reject) => {
      (window as any).gapi.load('client:auth2', () => {
        console.log('📚 Google API libraries loaded');
        (window as any).gapi.client.init({
          apiKey: GOOGLE_PHOTOS_CONFIG.apiKey,
          clientId: GOOGLE_PHOTOS_CONFIG.clientId,
          discoveryDocs: ['https://photoslibrary.googleapis.com/$discovery/rest?version=v1'],
          scope: 'https://www.googleapis.com/auth/photoslibrary.readonly'
        }).then(() => {
          console.log('✅ Google API client initialized');
          this.gapi = (window as any).gapi;
          this.isGoogleApiLoaded = true;
          resolve();
        }).catch((error: any) => {
          console.error('❌ Failed to initialize Google API client:', error);
          reject(error);
        });
      });
    });
  }

  private async fetchGooglePhotos(): Promise<Photo[]> {
    console.log('🔐 Checking authentication...');
    const authInstance = this.gapi.auth2.getAuthInstance();
    
    if (!authInstance.isSignedIn.get()) {
      console.log('🚪 Not signed in, prompting user...');
      await authInstance.signIn();
      console.log('✅ User signed in');
    } else {
      console.log('✅ Already signed in');
    }

    let response;
    
    console.log(`📁 Album ID: ${GOOGLE_PHOTOS_CONFIG.albumId}`);
    
    if (GOOGLE_PHOTOS_CONFIG.albumId) {
      console.log('📸 Fetching photos from specific album...');
      // Get photos from specific album
      response = await this.gapi.client.photoslibrary.mediaItems.search({
        albumId: GOOGLE_PHOTOS_CONFIG.albumId,
        pageSize: 50
      });
    } else {
      console.log('📸 Fetching all photos...');
      // Get all photos
      response = await this.gapi.client.photoslibrary.mediaItems.list({
        pageSize: 50
      });
    }

    console.log('📡 API Response:', response);
    const googlePhotos = response.result.mediaItems || [];
    console.log(`📊 Raw photos count: ${googlePhotos.length}`);
    
    const mappedPhotos = googlePhotos.map((item: any, index: number) => ({
      id: item.id,
      url: `${item.baseUrl}=w800-h600`,
      thumbnailUrl: `${item.baseUrl}=w300-h200`,
      caption: item.description || item.filename || `Photo ${index + 1}`,
      uploadedBy: 'Google Photos',
      timestamp: new Date(item.mediaMetadata.creationTime),
      tags: ['google-photos']
    }));
    
    console.log('✅ Mapped photos:', mappedPhotos);
    return mappedPhotos;
  }

  // Easy one-click method to sync with Google Photos
  async syncWithGooglePhotos(): Promise<void> {
    await this.loadGooglePhotos();
  }

  getGooglePhotosLink(): string {
    return GOOGLE_PHOTOS_CONFIG.albumId 
      ? `https://photos.google.com/album/${GOOGLE_PHOTOS_CONFIG.albumId}`
      : 'https://photos.google.com';
  }

  async uploadToGooglePhotos(file: File): Promise<string> {
    try {
      await this.initGoogleApi();
      
      // Upload to Google Photos (simplified)
      const formData = new FormData();
      formData.append('file', file);
      
      const uploadResponse = await fetch('https://photoslibrary.googleapis.com/v1/uploads', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.gapi.auth2.getAuthInstance().currentUser.get().getAuthResponse().access_token}`,
          'Content-Type': 'application/octet-stream',
          'X-Goog-Upload-File-Name': file.name,
          'X-Goog-Upload-Protocol': 'raw'
        },
        body: file
      });
      
      const uploadToken = await uploadResponse.text();
      
      // Create media item
      const createResponse = await this.gapi.client.photoslibrary.mediaItems.batchCreate({
        newMediaItems: [{
          description: 'Uploaded from Game Day Site',
          simpleMediaItem: {
            uploadToken: uploadToken
          }
        }]
      });
      
      return createResponse.result.newMediaItemResults[0].mediaItem.baseUrl;
    } catch (error) {
      console.error('Upload failed:', error);
      throw error;
    }
  }
}
