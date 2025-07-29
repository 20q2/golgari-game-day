export interface Photo {
  id: string;
  url: string;
  thumbnailUrl: string;
  caption?: string;
  uploadedBy?: string;
  timestamp: Date;
  tags?: string[];
}

export interface PhotoAlbum {
  id: string;
  title: string;
  description?: string;
  coverPhotoUrl?: string;
  photos: Photo[];
  createdDate: Date;
  isPublic: boolean;
}

export interface PhotoUpload {
  file: File;
  caption?: string;
  tags?: string[];
}