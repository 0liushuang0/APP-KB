import { Module } from '@nestjs/common';
import { FileArchiveService } from './file-archive.service';

@Module({
  providers: [FileArchiveService],
  exports: [FileArchiveService],
})
export class FileArchiveModule {}
