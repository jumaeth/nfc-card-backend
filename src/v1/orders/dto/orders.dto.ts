import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsEmail,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export const SHOP_LOCALES = ['de', 'en', 'fr', 'it'] as const;
export type ShopLocale = (typeof SHOP_LOCALES)[number];

export class ShippingAddressDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  line1!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  line2?: string;

  @ApiProperty()
  @IsString()
  @MinLength(2)
  @MaxLength(12)
  postalCode!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  city!: string;

  @ApiProperty({ description: 'ISO 3166-1 alpha-2, e.g. CH' })
  @IsString()
  @Length(2, 2)
  @Matches(/^[A-Za-z]{2}$/)
  country!: string;
}

export class OrderItemDto {
  @ApiProperty({ example: 'review' })
  @IsString()
  @MaxLength(40)
  productKey!: string;

  @ApiProperty({ minimum: 1, maximum: 1000 })
  @IsInt()
  @Min(1)
  @Max(1000)
  quantity!: number;

  @ApiProperty({ type: Object, description: "The editor's CardConfig" })
  @IsObject()
  design!: Record<string, unknown>;
}

/** Fields shared by guest (website) and app checkout. */
class OrderBaseDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  companyName?: string;

  @ApiProperty({ type: ShippingAddressDto })
  @ValidateNested()
  @Type(() => ShippingAddressDto)
  shippingAddress!: ShippingAddressDto;

  @ApiPropertyOptional({ enum: SHOP_LOCALES })
  @IsOptional()
  @IsIn(SHOP_LOCALES)
  locale?: ShopLocale;

  @ApiProperty({ type: [OrderItemDto] })
  @ValidateNested({ each: true })
  @Type(() => OrderItemDto)
  @ArrayMinSize(1)
  @ArrayMaxSize(5)
  items!: OrderItemDto[];
}

/** App checkout: the email comes from the signed-in user. */
export class CompanyOrderDto extends OrderBaseDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  customerName?: string;
}

/** Website checkout without an account. */
export class GuestOrderDto extends OrderBaseDto {
  @ApiProperty()
  @IsEmail()
  @MaxLength(200)
  email!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  customerName!: string;
}

export const ADMIN_ORDER_STATUSES = [
  'IN_PRODUCTION',
  'SHIPPED',
  'CANCELLED',
] as const;

export class UpdateOrderStatusDto {
  @ApiProperty({ enum: ADMIN_ORDER_STATUSES })
  @IsIn(ADMIN_ORDER_STATUSES)
  status!: (typeof ADMIN_ORDER_STATUSES)[number];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  trackingNumber?: string;
}

export class ListOrdersQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsIn([
    'PENDING_PAYMENT',
    'PAID',
    'IN_PRODUCTION',
    'SHIPPED',
    'CANCELLED',
    'EXPIRED',
  ])
  status?: string;

  @ApiPropertyOptional({
    enum: ['me', 'none'],
    description: 'me = claimed by the caller, none = not claimed yet',
  })
  @IsOptional()
  @IsIn(['me', 'none'])
  handler?: 'me' | 'none';

  @ApiPropertyOptional({ description: 'Search number, email, name or company' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;
}
