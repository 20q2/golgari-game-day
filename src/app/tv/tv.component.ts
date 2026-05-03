import { AfterViewInit, Component, ElementRef, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import * as QRCode from 'qrcode';

@Component({
  selector: 'app-tv',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './tv.component.html',
  styleUrls: ['./tv.component.scss']
})
export class TvComponent implements AfterViewInit {
  @ViewChild('qrCanvas', { static: true }) canvasRef!: ElementRef<HTMLCanvasElement>;

  readonly url = window.location.origin + '/golgari-game-day/';

  ngAfterViewInit(): void {
    QRCode.toCanvas(this.canvasRef.nativeElement, this.url, {
      width: 480,
      margin: 2
    }).catch((err: unknown) => {
      console.error('Failed to render QR code:', err);
    });
  }
}
