<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform" xmlns:sm="http://www.sitemaps.org/schemas/sitemap/0.9">
<xsl:output method="html" encoding="UTF-8" indent="yes"/>
<xsl:template match="/">
  <html lang="en">
    <head>
      <meta charset="utf-8"/>
      <title>Sitemap — El Paso Climate</title>
      <style>
        body { font-family: -apple-system, "Public Sans", sans-serif; background: #C3CFBB; color: #3E362E; margin: 0; padding: 2.5rem 1.5rem; }
        h1 { font-size: 1.4rem; margin: 0 0 0.25rem; }
        p.sub { color: #5A5148; margin: 0 0 1.5rem; font-size: 0.9rem; }
        table { border-collapse: collapse; width: 100%; max-width: 48rem; }
        th, td { text-align: left; padding: 0.6rem 1rem 0.6rem 0; border-bottom: 1px solid #798D6A; font-size: 0.9rem; }
        th { text-transform: uppercase; letter-spacing: 0.06em; font-size: 0.75rem; color: #5A5148; }
        a { color: #824536; }
      </style>
    </head>
    <body>
      <h1>Sitemap</h1>
      <p class="sub"><xsl:value-of select="count(sm:urlset/sm:url)"/> URL(s)</p>
      <table>
        <tr>
          <th>URL</th>
          <th>Change Frequency</th>
          <th>Priority</th>
        </tr>
        <xsl:for-each select="sm:urlset/sm:url">
          <tr>
            <td><a href="{sm:loc}"><xsl:value-of select="sm:loc"/></a></td>
            <td><xsl:value-of select="sm:changefreq"/></td>
            <td><xsl:value-of select="sm:priority"/></td>
          </tr>
        </xsl:for-each>
      </table>
    </body>
  </html>
</xsl:template>
</xsl:stylesheet>
