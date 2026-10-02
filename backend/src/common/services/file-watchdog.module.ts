import { Module } from '@nestjs/common';
import { FileWatchdogService } from './file-watchdog.service';

@Module({
  providers: [FileWatchdogService],
  exports: [FileWatchdogService],
})
export class FileWatchdogModule {}
