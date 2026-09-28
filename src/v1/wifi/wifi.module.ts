import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module.js';
import { CompanyAccessModule } from '../companies/company-access.module.js';
import { WifiAccessService } from './wifi-access.service.js';
import { WifiGuestsService } from './wifi-guests.service.js';
import {
  PublicWifiController,
  WifiGuestsController,
} from './wifi.controller.js';

// Wi-Fi guest access: the public email/code flow and the business's guest list.
// PrismaModule and EmailModule are @Global.
@Module({
  imports: [CompanyAccessModule, BillingModule],
  providers: [WifiAccessService, WifiGuestsService],
  controllers: [PublicWifiController, WifiGuestsController],
  // The admin console reads and erases guests through the same service.
  exports: [WifiGuestsService],
})
export class WifiModule {}
