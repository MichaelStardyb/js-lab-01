export async function fetchJson(url: string, options: RequestInit = {}) {
    const res = await fetch(url, options);
    if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`); // fetch не робить reject на 404, тому перевіряємо вручну
    return await res.json();
}

export async function loadAll<T>(manifest: T[], onProgress: (progress: number) => void): Promise<T[]> {
    let done = 0;
    // Promise.all дозволяє завантажувати всі файли одночасно, а не по черзі
    const promises = manifest.map(async (item: T) => {
        // Штучна затримка на півсекунди, щоб ми встигли побачити екран завантаження
        await new Promise(resolve => setTimeout(resolve, 500));
        done++;
        onProgress(done / manifest.length);
        return item;
    });
    return Promise.all(promises);
}