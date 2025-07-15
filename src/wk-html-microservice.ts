import bodyParser from 'body-parser';
import 'colors';
import express from 'express';
import rateLimit from 'express-rate-limit';
import { Express } from 'express-serve-static-core';
import * as http from 'http';
import strtostr from 'string-to-stream';
import wkhtmltox from './wkhtmltox';
import { AppController } from './controllers/app.controller';
import { PdfController } from './controllers/pdf.controller';
import { ImageController } from './controllers/image.controller';



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
      this.expressApp.post('/pdf', PdfController.generatePdf);
      this.expressApp.post('/img', ImageController.generateImage);
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
