import { Prisma } from '@prisma/client';
import { prisma } from '../models';
import { logger } from '../config';
import { AppError } from '../middleware';
import { CreateArticleInput, UpdateArticleInput, ListArticlesQuery } from '../types';

export async function createArticle(input: CreateArticleInput, authorId: string) {
  const article = await prisma.knowledgeArticle.create({
    data: {
      title: input.title,
      content: input.content,
      category: input.category,
      tags: input.tags,
      authorId,
    },
    include: {
      author: { select: { id: true, firstName: true, lastName: true } },
    },
  });

  logger.info({ articleId: article.id }, 'Knowledge article created');
  return article;
}

export async function getArticleById(id: string) {
  const article = await prisma.knowledgeArticle.findUnique({
    where: { id },
    include: {
      author: { select: { id: true, firstName: true, lastName: true } },
    },
  });

  if (!article) {
    throw new AppError(404, 'Article not found', 'NOT_FOUND');
  }

  // Fire-and-forget view count increment — don't block the response
  prisma.knowledgeArticle.update({
    where: { id },
    data: { viewCount: { increment: 1 } },
  }).catch(() => {});

  return { ...article, viewCount: article.viewCount + 1 };
}

export async function listArticles(query: ListArticlesQuery) {
  const { page, limit, status, category, search } = query;
  const skip = (page - 1) * limit;

  const where: Prisma.KnowledgeArticleWhereInput = {};
  if (status) where.status = status;
  if (category) where.category = category;
  if (search) {
    where.OR = [
      { title: { contains: search } },
    ];
  }

  const [articles, total] = await Promise.all([
    prisma.knowledgeArticle.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, title: true, category: true, tags: true,
        status: true, viewCount: true, createdAt: true, publishedAt: true,
        author: { select: { id: true, firstName: true, lastName: true } },
      },
    }),
    prisma.knowledgeArticle.count({ where }),
  ]);

  return {
    data: articles,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}

export async function updateArticle(id: string, input: UpdateArticleInput) {
  const article = await prisma.$transaction(async (tx) => {
    const existing = await tx.knowledgeArticle.findUnique({ where: { id } });
    if (!existing) {
      throw new AppError(404, 'Article not found', 'NOT_FOUND');
    }

    const updateData: Prisma.KnowledgeArticleUpdateInput = { ...input };
    if (input.status === 'PUBLISHED' && existing.status !== 'PUBLISHED') {
      updateData.publishedAt = new Date();
    }

    return tx.knowledgeArticle.update({
      where: { id },
      data: updateData,
      include: {
        author: { select: { id: true, firstName: true, lastName: true } },
      },
    });
  });

  logger.info({ articleId: id, status: input.status }, 'Article updated');
  return article;
}
