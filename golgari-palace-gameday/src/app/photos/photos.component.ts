import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDialogModule, MatDialog } from '@angular/material/dialog';
import { MatChipsModule } from '@angular/material/chips';
import { MatGridListModule } from '@angular/material/grid-list';
import { Observable } from 'rxjs';
import { PhotosService } from '../services/photos.service';
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

  openGooglePhotos(): void {
    window.open(this.googlePhotosLink, '_blank');
  }

  openPhotoDialog(photo: Photo): void {
    // TODO: Implement photo detail dialog
    console.log('Opening photo:', photo.caption);
  }

  uploadPhoto(): void {
    // TODO: Implement photo upload dialog
    console.log('Upload photo functionality');
  }

  trackByPhotoId(index: number, photo: Photo): string {
    return photo.id;
  }
}
