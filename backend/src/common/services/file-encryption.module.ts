import { Module } from '@nestjs/common';
import { FileEncryptionService } from './file-encryption.service';

@Module({
  providers: [FileEncryptionService],
  exports: [FileEncryptionService],
})
export class FileEncryptionModule {}
