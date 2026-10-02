import { Module } from '@nestjs/common';
import { DataPortabilityService } from './data-portability.service';
import { DataPortabilityController } from './data-portability.controller';

@Module({
  controllers: [DataPortabilityController],
  providers: [DataPortabilityService],
  exports: [DataPortabilityService],
})
export class DataPortabilityModule {}
