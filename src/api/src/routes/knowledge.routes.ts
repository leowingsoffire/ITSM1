import { Router, Request, Response, NextFunction } from 'express';
import { authenticate } from '../middleware';
import { knowledgeService } from '../services';
import { createArticleSchema, updateArticleSchema, listArticlesQuerySchema } from '../types';

const router = Router();

router.use(authenticate);

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const query = listArticlesQuerySchema.parse(req.query);
    const result = await knowledgeService.listArticles(query);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const article = await knowledgeService.getArticleById(req.params.id as string);
    res.json({ data: article });
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = createArticleSchema.parse(req.body);
    const article = await knowledgeService.createArticle(input, req.user!.userId);
    res.status(201).json({ data: article });
  } catch (err) {
    next(err);
  }
});

router.patch('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const input = updateArticleSchema.parse(req.body);
    const article = await knowledgeService.updateArticle(req.params.id as string, input);
    res.json({ data: article });
  } catch (err) {
    next(err);
  }
});

export { router as knowledgeRouter };
