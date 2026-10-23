import { IsBoolean, IsString, MaxLength, Matches } from 'class-validator';

export class SaveLicenseReceiverDto {
  @IsString() @MaxLength(2048) url: string;
  @IsString() @MaxLength(2048) resource: string;
  @IsString() @MaxLength(255) @Matches(/^\S+$/) audience: string;
  @IsBoolean() enabled: boolean;
}
