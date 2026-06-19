import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { CommonAuthModule } from './common/common-auth.module';
import appConfig from './config/app.config';
import authConfig from './config/auth.config';
import databaseConfig from './config/database.config';
import hemiaLegalConfig from './config/hemia-legal.config';
import { envVarsSchema } from './config/env.validation';
import paypalConfig from './config/paypal.config';
import { DatabaseModule } from './database/database.module';
import { IdentityModule } from './modules/identity';
import { BillingModule } from './modules/billing.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '.env.local'],
      load: [
        appConfig,
        authConfig,
        databaseConfig,
        hemiaLegalConfig,
        paypalConfig,
      ],
      validationSchema: envVarsSchema,
      validationOptions: { allowUnknown: true, abortEarly: true },
    }),
    CommonAuthModule,
    DatabaseModule,
    IdentityModule,
    BillingModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
