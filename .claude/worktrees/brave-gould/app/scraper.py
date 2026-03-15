import requests
from bs4 import BeautifulSoup
from app.chunking import chunk_text
from app.database import insert_document
from urllib.parse import urljoin, urlparse
from app.database import get_connection


def scrape_page(url: str) -> dict:
    response = requests.get(url)
    response.raise_for_status()

    soup = BeautifulSoup(response.text, "html.parser")

    # Remove scripts and styles
    for tag in soup(["script", "style", "noscript"]):
        tag.decompose()

    title = soup.title.string.strip() if soup.title else "No Title"

    # Extract visible text
    main = soup.find("main")
    if main:
        text = main.get_text(separator="\n")
    else:
        text = soup.get_text(separator="\n")

    # Clean extra whitespace
    lines = [line.strip() for line in text.splitlines()]
    clean_text = "\n".join([line for line in lines if line])

    return {
        "url": url,
        "title": title,
        "content": clean_text
    }

def extract_internal_links(soup, base_url: str) -> set:
    links = set()
    parsed_base = urlparse(base_url)
    base_domain = parsed_base.netloc

    for a_tag in soup.find_all("a", href=True):
        href = a_tag["href"]

        # Ignore anchors and mail/tel
        if href.startswith("#") or href.startswith("mailto:") or href.startswith("tel:"):
            continue

        full_url = urljoin(base_url, href)
        parsed_url = urlparse(full_url)

        # Keep only same-domain links
        if parsed_url.netloc == base_domain:
            links.add(full_url.split("#")[0])  # remove anchors

    return links


if __name__ == "__main__":
    try:
        base_url = "https://alphawave.hr/"

        visited = set()
        to_visit = set([base_url])

        print("Starting crawl...")

        while to_visit:
            url = to_visit.pop()

            if url in visited:
                continue

            print(f"\nScraping: {url}")

            try:
                data = scrape_page(url)
            except Exception as e:
                print(f"Failed to scrape {url}: {e}")
                visited.add(url)
                continue
            visited.add(url)
            
            # Extract links from current page
            response = requests.get(url)
            soup = BeautifulSoup(response.text, "html.parser")
            links = extract_internal_links(soup, base_url)

            for link in links:
                if link not in visited:
                    to_visit.add(link)

            # Chunk and insert
            chunks = chunk_text(data["content"])

            for i, chunk in enumerate(chunks):
                insert_document(
                    url=url,
                    title=f"{data['title']} (chunk {i+1})",
                    content=chunk
                )

        print("\nRunning ANALYZE...")
        conn = get_connection()
        cursor = conn.cursor()
        cursor.execute("ANALYZE documents;")
        conn.commit()
        cursor.close()
        conn.close()

        print("\nCrawl completed successfully!")

    except Exception as e:
        print("Error occurred:")
        print(e)