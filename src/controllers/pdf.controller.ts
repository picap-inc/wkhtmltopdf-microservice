import { Request, Response } from 'express-serve-static-core';
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

// Helper to convert camelCase to kebab-case
function toKebabCase(str: string): string {
  return str.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
}

export class PdfController {
   /**
    * Generate PDF from HTML
    */
   public static async generatePdf(request: Request, response: Response): Promise<void> {
      const { html, footerHtml, wkConfig } = request.body;
      if (!html) {
         response.status(400).json({ error: 'Missing html field in request body' });
         return;
      }
      
      // Write main HTML to temp file
      const htmlPath = path.join(os.tmpdir(), `main-${Date.now()}.html`);
      fs.writeFileSync(htmlPath, html);
      let footerPath = '';
      let args: string[] = [];
      
      // Add headless-specific options for better compatibility
      args.push('--no-stop-slow-scripts');
      args.push('--javascript-delay', '1000');
      args.push('--enable-local-file-access');
      args.push('--quiet');
      args.push('--disable-smart-shrinking');
      
      if (wkConfig && typeof wkConfig === 'object') {
         for (const [key, value] of Object.entries(wkConfig)) {
            const dashKey = toKebabCase(key);
            if (typeof value === 'boolean') {
               if (value) args.push(`--${dashKey}`);
            } else {
               args.push(`--${dashKey}`);
               args.push(String(value));
            }
         }
      }
      
      if (footerHtml) {
         footerPath = path.join(os.tmpdir(), `footer-${Date.now()}.html`);
         fs.writeFileSync(footerPath, footerHtml);
         args.push('--footer-html');
         args.push(footerPath);
      }
      
      // Generate unique output file path
      const outputPath = path.join(os.tmpdir(), `output-${Date.now()}.pdf`);
      args.push(htmlPath);
      args.push(outputPath); // output to file instead of stdout
      
      console.log('[wkhtmltopdf] Command:', 'wkhtmltopdf', args.join(' '));
      console.log('[wkhtmltopdf] Output file:', outputPath);
      
      const child = spawn('wkhtmltopdf', args, {
         env: {
            ...process.env,
            DISPLAY: ':99',
            XDG_RUNTIME_DIR: '/tmp/runtime-root',
            QT_QPA_PLATFORM: 'linuxfb',
            USER: 'root'
         }
      });
      
      let errorOutput = '';
      child.stderr.on('data', (data) => {
         errorOutput += data.toString();
         // Log stderr for debugging
         console.log('[wkhtmltopdf] stderr:', data.toString());
      });
      
      child.on('error', (err) => {
         console.error('[wkhtmltopdf] Failed to start process:', err);
         response.status(500).json({ error: 'Failed to start wkhtmltopdf', details: err.message });
         cleanup();
      });
      
      child.on('close', async (code) => {
         if (code !== 0) {
            console.error('[wkhtmltopdf] Process exited with code', code, 'stderr:', errorOutput);
            if (!response.headersSent) {
               response.status(500).json({ error: 'wkhtmltopdf failed', code, stderr: errorOutput });
            }
            cleanup();
            return;
         }
         
         // Check if output file exists and has content
         try {
            const stats = fs.statSync(outputPath);
            if (stats.size === 0) {
               console.error('[wkhtmltopdf] Generated PDF file is empty');
               if (!response.headersSent) {
                  response.status(500).json({ error: 'Generated PDF file is empty' });
               }
               cleanup();
               return;
            }
            
            console.log('[wkhtmltopdf] PDF generated successfully, size:', stats.size, 'bytes');
            
            // Read the file and send it as response
            const pdfBuffer = fs.readFileSync(outputPath);
            response.writeHead(200, { 
               'Content-Type': 'application/pdf',
               'Content-Length': stats.size
            });
            response.end(pdfBuffer);
            
         } catch (err) {
            console.error('[wkhtmltopdf] Error reading generated PDF:', err);
            if (!response.headersSent) {
               response.status(500).json({ error: 'Error reading generated PDF', details: err instanceof Error ? err.message : String(err) });
            }
         } finally {
            cleanup();
         }
      });
      
      function cleanup() {
         // try { fs.unlinkSync(htmlPath); } catch {}
         // if (footerPath) { try { fs.unlinkSync(footerPath); } catch {} }
         // try { fs.unlinkSync(outputPath); } catch {}
      }
   }
} 