import { Module } from '@nestjs/common';
import { MediumService } from './medium.service';
import { MediumController } from './medium.controller';
import { HttpModule } from '@nestjs/axios';
import { TokenGuard } from './Guards/token-guard';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Deployment } from './entities/deployment.entity';
import { RestoredbModule } from 'src/restoredb/restoredb.module';
import { WorkerService } from 'src/worker.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Deployment ]), // Import the User entity for TypeORM
    HttpModule,
  ],
  providers: [MediumService,TokenGuard,WorkerService],
  controllers: [MediumController],
  exports :[MediumService,WorkerService]
})
export class MediumModule {}
