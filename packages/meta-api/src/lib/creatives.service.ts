import { MetaHttpClient } from './meta-http.client.js';
import { MetaAdCreativeSchema, type MetaAdCreative } from '@adtech/shared-types';
import * as crypto from 'crypto';

const CREATIVE_FIELDS = [
  'id', 'name', 'title', 'body',
  'image_hash', 'image_url', 'thumbnail_url',
  'video_id', 'call_to_action_type',
  'object_story_spec', 'effective_object_story_id',
  'created_time',
].join(',');

export interface CreativeWithHash extends MetaAdCreative {
  globalAssetId: string;
  assetType: 'IMAGE' | 'VIDEO' | 'CAROUSEL';
}

export class CreativesService {
  constructor(private readonly client: MetaHttpClient) {}

  async getCreative(creativeId: string): Promise<MetaAdCreative> {
    const raw = await this.client.get<unknown>(creativeId, {
      fields: CREATIVE_FIELDS,
    });

    return MetaAdCreativeSchema.parse(raw);
  }

  async getAccountCreatives(accountId: string): Promise<MetaAdCreative[]> {
    const raw = await this.client.getAll<unknown>(
      `${accountId}/adcreatives`,
      { fields: CREATIVE_FIELDS },
    );

    return raw.map((item) => MetaAdCreativeSchema.parse(item));
  }

  // Generovanie interného global_asset_id pre entity resolution
  generateGlobalAssetId(creative: MetaAdCreative): CreativeWithHash {
    let assetKey: string;
    let assetType: 'IMAGE' | 'VIDEO' | 'CAROUSEL';

    if (creative.video_id) {
      // Pre videá: video_id je prirodzene unikátny
      assetKey = `video:${creative.video_id}`;
      assetType = 'VIDEO';
    } else if (creative.image_hash) {
      // Pre obrázky: image_hash identifikuje vizuál
      assetKey = `image:${creative.image_hash}`;
      assetType = 'IMAGE';
    } else if (creative.object_story_spec) {
      // Pre carousel: hash z object_story_spec
      const specStr = JSON.stringify(creative.object_story_spec);
      assetKey = `carousel:${crypto.createHash('md5').update(specStr).digest('hex')}`;
      assetType = 'CAROUSEL';
    } else {
      // Fallback: hash z ID kreatívy
      assetKey = `unknown:${creative.id}`;
      assetType = 'IMAGE';
    }

    const globalAssetId = crypto
      .createHash('sha256')
      .update(assetKey)
      .digest('hex')
      .substring(0, 32);

    return {
      ...creative,
      globalAssetId,
      assetType,
    };
  }

  // Získanie čerstvej CDN URL pre kreatívu (pre Media Proxy)
  async getFreshCreativeUrl(creativeId: string): Promise<{
    imageUrl?: string;
    thumbnailUrl?: string;
    videoId?: string;
  }> {
    const creative = await this.getCreative(creativeId);

    return {
      imageUrl: creative.image_url,
      thumbnailUrl: creative.thumbnail_url,
      videoId: creative.video_id,
    };
  }
}
