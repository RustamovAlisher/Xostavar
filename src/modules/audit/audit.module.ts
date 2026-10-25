import { Global, Module } from '@nestjs/common';
import { AuditController } from './controllers/audit.controller.js';
import { AuditService } from './services/audit.service.js';

/** Global: har modul o'z amalini auditga yozadi. */
@Global()
@Module({ controllers: [AuditController], providers: [AuditService], exports: [AuditService] })
export class AuditModule {}
