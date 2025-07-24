import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { Deployment } from './medium/entities/deployment.entity';
import { ConfigService } from '@nestjs/config';

// For standalone use, you can instantiate ConfigService with environment variables
const configService = new ConfigService();

export const AppDataSource = new DataSource({
  type: 'mysql',
  host: configService.get<string>('DB_HOST', 'localhost'),
  port: configService.get<number>('DB_PORT', 5432),
  username: configService.get<string>('DB_USERNAME', 'your_user'),
  password: configService.get<string>('DB_PASSWORD', 'your_pass'),
  database: configService.get<string>('DB_NAME', 'your_db'),
  entities: [Deployment],
  synchronize: false,
  logging: false,
});

// Initialize the DataSource (call this where needed)
export const initializeDataSource = async () => {
  await AppDataSource.initialize();
};