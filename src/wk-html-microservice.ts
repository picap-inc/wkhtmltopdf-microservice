import bodyParser from 'body-parser';
import 'colors';
import express from 'express';
import rateLimit from 'express-rate-limit';
import { Express, Request, Response } from 'express-serve-static-core';
import * as http from 'http';
import strtostr from 'string-to-stream';
import wkhtmltox from './wkhtmltox';
import { AppController } from './controllers/app.controller';
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

// Helper to convert camelCase to kebab-case
function toKebabCase(str: string): string {
  return str.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
}

export class WkHtmlMicroservice {
   public expressApp: Express;
   public wkHtmlConverter: wkhtmltox;
   public httpServer: http.Server;

   constructor() {
      this.expressApp = express();
      this.wkHtmlConverter = new wkhtmltox();
      this.configureExpressApp();

      this.httpServer = http.createServer(this.expressApp).listen(process.env.NODE_PORT || 9100, () => {
         this.logAppIsRunning();
      });
   }

   /**
    * Configure Express App
    */
   public configureExpressApp(): void {
      this.setMiddleware();
      this.setAppRoutes();
   }

   /**
    * Set Middleware
    */
   private setMiddleware(): void {
      this.expressApp.use(bodyParser.json({ limit: process.env.MAX_BODY || '50mb' }));
      this.expressApp.use(
         rateLimit({
            windowMs: 60 * 1000, // 1 minutes
            max: process.env.MAX_REQUESTS ? parseInt(process.env.MAX_REQUESTS) : 100, // Limit each IP to 100 requests per `window` (here, per 15 minutes)
            standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
            legacyHeaders: false, // Disable the `X-RateLimit-*` headers
         })
      );
   }

   /**
    * Set App Routes
    */
   private setAppRoutes(): void {
      this.expressApp.get('/', AppController.getLandingPage);

      this.expressApp.post('/pdf', async (request: Request, response: Response) => {
         const { html, footerHtml, wkConfig } = request.body;
         if (!html) {
            response.status(400).json({ error: 'Missing html field in request body' });
            return;
         }
         // Write main HTML to temp file, injecting number_pages script into <head>
         let htmlToWrite = html;
         const scriptToInject = `<script>
      function number_pages() {
          console.log('number_pages() called via onload');
          var vars = {};
          var x = document.location.search.substring(1).split('&');
          for (var i in x) {
              var z = x[i].split('=', 2);
              vars[z[0]] = decodeURIComponent(z[1]);
          }
          var x = ['frompage', 'topage', 'page', 'webpage', 'section', 'subsection', 'subsubsection'];
          for (var i in x) {
              var y = document.getElementsByClassName(x[i]);
              for (var j = 0; j < y.length; ++j) {
                  y[j].textContent = vars[x[i]];
              }
          }
          // Add a visual indicator that the function ran
          var footer = document.querySelector('div[style*="text-align:center"]');
          if (footer) {
              var indicator = document.createElement('span');
              indicator.style.color = 'red';
              indicator.style.fontSize = '8px';
              indicator.textContent = ' [onload executed]';
              footer.appendChild(indicator);
          }
      }
  </script>`;
         if (/<head[^>]*>/i.test(htmlToWrite)) {
           htmlToWrite = htmlToWrite.replace(/(<head[^>]*>)/i, `$1${scriptToInject}`);
         } else {
           htmlToWrite = `<head>${scriptToInject}</head>` + htmlToWrite;
         }
         // Inject onload="number_pages()" into <body> if present
         if (/<body[^>]*>/i.test(htmlToWrite)) {
           htmlToWrite = htmlToWrite.replace(/<body([^>]*)>/i, (match: string, attrs: string) => {
             if (/onload\s*=/.test(attrs)) {
               // If onload already exists, append number_pages()
               return `<body${attrs.replace(/onload\s*=\s*(["'])((?:\\\1|.)*?)\1/, (m: string, q: string, val: string) => `onload=${q}${val};number_pages()${q}`)}>`;
             } else {
               return `<body${attrs} onload=\"number_pages()\">`;
             }
           });
         }
         const htmlPath = path.join(os.tmpdir(), `main-${Date.now()}.html`);
         fs.writeFileSync(htmlPath, htmlToWrite);
         let footerPath = '';
         let args: string[] = [];
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
         args.push(htmlPath);
         args.push('-'); // output to stdout
         console.log('[wkhtmltopdf] Command:', 'wkhtmltopdf', args.join(' '));
         const child = spawn('wkhtmltopdf', args);
         let errorOutput = '';
         child.stderr.on('data', (data) => {
            errorOutput += data.toString();
         });
         child.on('error', (err) => {
            console.error('[wkhtmltopdf] Failed to start process:', err);
            response.status(500).json({ error: 'Failed to start wkhtmltopdf', details: err.message });
            cleanup();
         });
         child.on('close', (code) => {
            cleanup();
            if (code !== 0) {
               console.error('[wkhtmltopdf] Process exited with code', code, 'stderr:', errorOutput);
               if (!response.headersSent) {
                  response.status(500).json({ error: 'wkhtmltopdf failed', code, stderr: errorOutput });
               }
            }
         });
         response.writeHead(200, { 'Content-Type': 'application/pdf' });
         child.stdout.pipe(response);
         function cleanup() {
            try { fs.unlinkSync(htmlPath); } catch {}
            if (footerPath) { try { fs.unlinkSync(footerPath); } catch {} }
         }
      });

      this.expressApp.post('/img', async (request: Request, response: Response) => {
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
         const child = spawn('wkhtmltoimage', args);
         let errorOutput = '';
         child.stderr.on('data', (data) => {
            errorOutput += data.toString();
         });
         child.on('error', (err) => {
            console.error('[wkhtmltoimage] Failed to start process:', err);
            response.status(500).json({ error: 'Failed to start wkhtmltoimage', details: err.message });
            cleanup();
         });
         child.on('close', (code) => {
            cleanup();
            if (code !== 0) {
               console.error('[wkhtmltoimage] Process exited with code', code, 'stderr:', errorOutput);
               if (!response.headersSent) {
                  response.status(500).json({ error: 'wkhtmltoimage failed', code, stderr: errorOutput });
               }
            }
         });
         response.writeHead(200, { 'Content-Type': 'image/jpeg' });
         child.stdout.pipe(response);
         function cleanup() {
            try { fs.unlinkSync(htmlPath); } catch {}
         }
      });
   }

   /**
    * Log express instance is running on {port}
    */
   private logAppIsRunning(): void {
      console.log(
         '\n     wkhtmltopdf service is listening on http://localhost:%d'.green,
         process.env.NODE_PORT || 9100
      );
   }

   /**
    * Get ExpressApp
    */
   public getExpressApp(): Express {
      return this.expressApp;
   }

   /**
    * Get httpServer instance
    */
   public getServerInstance(): http.Server {
      return this.httpServer;
   }
}
