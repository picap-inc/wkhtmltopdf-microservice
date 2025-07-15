import { Request, Response } from 'express-serve-static-core';
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

// Helper to convert camelCase to kebab-case
function toKebabCase(str: string): string {
  return str.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
}

export class ImageController {
   /**
    * Generate Image from HTML
    */
   public static async generateImage(request: Request, response: Response): Promise<void> {
      const { html, wkConfig } = request.body;
      if (!html) {
         response.status(400).json({ error: 'Missing html field in request body' });
         return;
      }
      
      // Write main HTML to temp file
      const htmlPath = path.join(os.tmpdir(), `main-img-${Date.now()}.html`);
      fs.writeFileSync(htmlPath, html);
      let args: string[] = [];
      
      // Only allow valid wkhtmltoimage options
      const allowedImgOptions = new Set([
         'width', 'height', 'quality', 'format', 'crop-h', 'crop-w', 'crop-x', 'crop-y', 'transparent',
         'disable-smart-width', 'enable-local-file-access', 'encoding', 'custom-header', 'custom-header-propagation', 'user-style-sheet', 'javascript-delay', 'no-stop-slow-scripts', 'ssl-protocol', 'zoom', 'insecure', 'debug-javascript', 'no-images', 'disable-javascript', 'enable-plugins', 'transparent', 'background', 'no-background', 'out'
      ]);
      
      if (wkConfig && typeof wkConfig === 'object') {
         for (const [key, value] of Object.entries(wkConfig)) {
            const dashKey = toKebabCase(key);
            if (allowedImgOptions.has(dashKey)) {
               if (typeof value === 'boolean') {
                  if (value) args.push(`--${dashKey}`);
               } else {
                  args.push(`--${dashKey}`);
                  args.push(String(value));
               }
            }
         }
      }
      
      args.push(htmlPath);
      args.push('-'); // output to stdout
      
      console.log('[wkhtmltoimage] Command:', 'wkhtmltoimage', args.join(' '));
      
      const child = spawn('wkhtmltoimage', args, {
         env: {
            ...process.env,
            DISPLAY: ':99',
            XDG_RUNTIME_DIR: '/tmp/runtime-root',
            QT_QPA_PLATFORM: 'linuxfb',
            USER: 'root'
         }
      });
      
      let imageData = Buffer.alloc(0);
      let errorOutput = '';
      
      child.stdout.on('data', (data) => {
         imageData = Buffer.concat([imageData, data]);
      });
      
      child.stderr.on('data', (data) => {
         errorOutput += data.toString();
         console.log('[wkhtmltoimage] stderr:', data.toString());
      });
      
      child.on('error', (err) => {
         console.error('[wkhtmltoimage] Failed to start process:', err);
         response.status(500).json({ error: 'Failed to start wkhtmltoimage', details: err.message });
         cleanup();
      });
      
      child.on('close', async (code) => {
         if (code !== 0) {
            console.error('[wkhtmltoimage] Process exited with code', code, 'stderr:', errorOutput);
            if (!response.headersSent) {
               response.status(500).json({ error: 'wkhtmltoimage failed', code, stderr: errorOutput });
            }
            cleanup();
            return;
         }
         
         if (imageData.length === 0) {
            console.error('[wkhtmltoimage] Generated image is empty');
            if (!response.headersSent) {
               response.status(500).json({ error: 'Generated image is empty' });
            }
            cleanup();
            return;
         }
         
         console.log('[wkhtmltoimage] Image generated successfully, size:', imageData.length, 'bytes');
         
         // Determine content type based on format or default to PNG
         const format = wkConfig?.format || 'png';
         const contentType = `image/${format.toLowerCase()}`;
         
         response.writeHead(200, { 
            'Content-Type': contentType,
            'Content-Length': imageData.length
         });
         response.end(imageData);
         cleanup();
      });
      
      function cleanup() {
         // try { fs.unlinkSync(htmlPath); } catch {}
      }
   }
} 