import { Global, Module } from '@nestjs/common';
import { SettingsController } from './controllers/settings.controller.js';
import { SettingsService } from './services/settings.service.js';

/** Global: kassa va ombor biznes qoidalarini shu yerdan oladi. */
@Global()
@Module({ controllers: [SettingsController], providers: [SettingsService], exports: [SettingsService] })
export class SettingsModule {}
