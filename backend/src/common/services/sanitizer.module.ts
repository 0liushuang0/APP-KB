import { Module } from '@nestjs/common';
import { SanitizerService } from './sanitizer.service';
import { SanitizerController } from './sanitizer.controller';

@Module({
  controllers: [SanitizerController],
  providers: [SanitizerService],
  exports: [SanitizerService],
})
export class SanitizerModule {}
