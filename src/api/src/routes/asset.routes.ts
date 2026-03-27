import { Router, Request, Response, NextFunction } from 'express';
import { authenticate } from '../middleware';
import { assetService } from '../services';
import { createAssetSchema, updateAssetSchema, listAssetsQuerySchema } from '../types';

const router = Router();

router.use(authenticate);

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const query = listAssetsQuerySchema.parse(req.query);
    const result = await assetService.listAssets(query);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const asset = await assetService.getAssetById(req.params.id as string);
    res.json({ data: asset });
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = createAssetSchema.parse(req.body);
    const asset = await assetService.createAsset(input);
    res.status(201).json({ data: asset });
  } catch (err) {
    next(err);
  }
});

router.patch('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = updateAssetSchema.parse(req.body);
    const asset = await assetService.updateAsset(req.params.id as string, input);
    res.json({ data: asset });
  } catch (err) {
    next(err);
  }
});

export { router as assetRouter };
