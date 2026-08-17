import { supabase } from './supabase';

export class CreateBusinessError extends Error {}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // sin acentos, mismo truco que looksLikeOrderIntent en @bicho/shared
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

export async function createBusiness(name: string): Promise<{ id: string; slug: string }> {
  const slug = slugify(name);
  if (slug.length < 3) {
    throw new CreateBusinessError('El nombre es muy corto para generar una URL válida.');
  }

  const { data, error } = await supabase.rpc('create_business', {
    p_name: name,
    p_slug: slug,
  });

  if (error) {
    // El slug es único: si ya existe, el mensaje de Postgres es de duplicate key.
    if (error.message.includes('duplicate key')) {
      throw new CreateBusinessError('Ya existe un comercio con un nombre muy parecido.');
    }
    throw new CreateBusinessError(error.message);
  }

  return { id: data.id, slug: data.slug };
}
