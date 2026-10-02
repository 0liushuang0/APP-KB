import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { RolesService } from '../src/modules/roles/roles.service';
import { UsersService } from '../src/modules/users/users.service';
import { ConfigService } from '@nestjs/config';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const rolesService = app.get(RolesService);
  const usersService = app.get(UsersService);
  const configService = app.get(ConfigService);

  await rolesService.seedSystemRoles();

  const username = configService.get('app.defaultAdmin.username');
  let admin = await usersService.findByUsername(username);

  if (!admin) {
    const adminRole = await rolesService.findByCode('admin');
    admin = await usersService.create({
      username,
      password: configService.get('app.defaultAdmin.password'),
      nickname: configService.get('app.defaultAdmin.nickname'),
      email: configService.get('app.defaultAdmin.email'),
      roleIds: adminRole ? [adminRole.id] : [],
    });
  }

  if (!admin.isSystemAdmin) {
    await usersService.update(admin.id, { isSystemAdmin: true });
  }

  console.log(`Default admin ensured: ${admin.username}`);
  await app.close();
}

bootstrap().catch((err) => {
  console.error(err);
  process.exit(1);
});
