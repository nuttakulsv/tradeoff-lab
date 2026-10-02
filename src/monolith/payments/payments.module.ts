import { Module } from '@nestjs/common';
import { PaymentsService } from './payments.service.js';

@Module({ providers: [PaymentsService], exports: [PaymentsService] })
export class PaymentsModule {}
