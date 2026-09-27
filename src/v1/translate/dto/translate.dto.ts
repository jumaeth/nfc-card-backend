import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

// Mirrors `Locale` in the app's lib/page-content.ts.
export const LOCALES = ['de', 'en', 'fr', 'it'] as const;
export type Locale = (typeof LOCALES)[number];

/** The text and languages. The admin console sends this with the page in the URL. */
export class TranslateTextDto {
  @ApiProperty({
    example: 'Salat mit Ziegenkäse',
    minLength: 1,
    maxLength: 2000,
  })
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  text!: string;

  @ApiProperty({
    enum: LOCALES,
    example: 'de',
    description: 'Language the text is written in.',
  })
  @IsIn(LOCALES)
  from!: Locale;

  @ApiProperty({ enum: LOCALES, isArray: true, example: ['en', 'fr', 'it'] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(LOCALES.length)
  @IsIn(LOCALES, { each: true })
  to!: Locale[];
}

/** The app's variant: the page travels in the body. */
export class TranslateDto extends TranslateTextDto {
  @ApiProperty({
    description:
      'Page the text belongs to (counts toward the monthly page limit).',
  })
  @IsString()
  pageId!: string;
}
