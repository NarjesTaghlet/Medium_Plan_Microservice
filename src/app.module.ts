import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { MediumModule } from './medium/medium.module';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Deployment } from './medium/entities/deployment.entity';
import { RestoredbModule } from './restoredb/restoredb.module';



@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env', // Change à '.env' si à la racine, ou garde 'src/.env' si dans src/
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => {
        console.log('SECRET_KEY in TypeOrm config:', process.env.SECRET_KEY); // Debug
        return {
          type: 'mysql',
    //host: 'localhost',
    host : process.env.DB_HOST,
    port: 3307,
    username: 'root',
    password: '',
    database: 'mediumplan',
    entities: [Deployment],
    synchronize: true,
        };
      },
      inject: [ConfigService],
    }),
   MediumModule,
   RestoredbModule,
  ],
  controllers: [AppController],
  providers: [AppService], // Retire JwtStrategy d'ici
})
export class AppModule {}
