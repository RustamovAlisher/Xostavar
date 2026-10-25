import { Global, Module } from '@nestjs/common';
import { AuditController } from './controllers/audit.controller.js';
import { AuditRepository } from './repositories/audit.repository.js';
import { AuditService } from './services/audit.service.js';

/** Global: har modul o'z amalini auditga yozadi. */
@Global()
@Module({ controllers: [AuditController], providers: [AuditService, AuditRepository], exports: [AuditService] })
export class AuditModule {}
