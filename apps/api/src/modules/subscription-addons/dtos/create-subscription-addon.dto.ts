import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class CreateSubscriptionAddonDto {
  @IsString()
  @MaxLength(100)
  addonCode: string;

  @IsInt()
  @Min(1)
  quantity: number;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  idempotencyKey?: string;
}
