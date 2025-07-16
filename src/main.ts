import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import crypto from 'crypto';
(global as any).crypto = crypto;
async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  //const app = await NestFactory.create(AppModule);
  app.enableCors({
    origin: ['http://localhost:4200','https://d398rqqt4ze3my.cloudfront.net'] ,// ✅ Autoriser uniquement le frontend Angular
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    allowedHeaders: 'Content-Type,Authorization',
    credentials: true, // ✅ Si besoin d'authentification (JWT, Cookies)
  });

 //await app.listen(3004);
 
 await app.listen(3033);

}
bootstrap();
