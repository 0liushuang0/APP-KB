import { Module, Global } from '@nestjs/common';
import { KeychainService } from './keychain.service';

@Global()
@Module({
  providers: [KeychainService],
  exports: [KeychainService],
})
export class KeychainModule {}
