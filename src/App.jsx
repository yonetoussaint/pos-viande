import React, { useState, useEffect, useMemo, useCallback } from "react";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://diznhmmgkrdfdjxuhurw.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRpem5obW1na3JkZmRqeHVodXJ3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc4MjI1MzAsImV4cCI6MjEwMzM5ODUzMH0.5jzwMzZjvQMlIWmhHXcCcAW27vnf8k4TbZQCQ40fjTE";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const FRACTIONS = [
  { label: "Caisse", valeur: 1 },
  { label: "1/2 caisse", valeur: 0.5 },
  { label: "1/4 caisse", valeur: 0.25 },
];

const MODES_PAIEMENT = ["Cash", "MonCash", "NatCash"];

const fmt = (n) =>
  Number(n).toLocaleString("fr-HT", { minimumFractionDigits: 0, maximumFractionDigits: 2 });

function genId() {
  return Math.random().toString(36).slice(2, 9);
}

export default function POSViande() {
  const [session, setSession] = useState(null);
  const [profil, setProfil] = useState(null);
  const [chargement, setChargement] = useState(true);

  const [produits, setProduits] = useState([]);
  const [profils, setProfils] = useState([]);
  const [ventes, setVentes] = useState([]);

  const [panier, setPanier] = useState([]);
  const [vue, setVue] = useState("vente");
  const [modalCheckout, setModalCheckout] = useState(false);
  const [modePaiement, setModePaiement] = useState("Cash");
  const [montantRecu, setMontantRecu] = useState("");
  const [recu, setRecu] = useState(null);
  const [erreur, setErreur] = useState("");
  const [enTraitement, setEnTraitement] = useState(false);

  // ---------- Session ----------
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setChargement(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) {
      setProfil(null);
      return;
    }
    supabase
      .from("profiles")
      .select("*")
      .eq("id", session.user.id)
      .single()
      .then(({ data }) => setProfil(data));
  }, [session]);

  const estPDG = profil?.role === "pdg";

  // ---------- Chargement des données ----------
  const chargerProduits = useCallback(async () => {
    const { data } = await supabase.from("produits").select("*").order("nom");
    if (data) setProduits(data);
  }, []);

  const chargerProfils = useCallback(async () => {
    const { data } = await supabase.from("profiles").select("*").order("nom_complet");
    if (data) setProfils(data);
  }, []);

  const chargerVentes = useCallback(async () => {
    const { data } = await supabase
      .from("ventes")
      .select("*, vente_lignes(*), profiles(nom_complet)")
      .order("created_at", { ascending: false });
    if (data) setVentes(data);
  }, []);

  useEffect(() => {
    if (!session) return;
    chargerProduits();
    chargerProfils();
    chargerVentes();
  }, [session, chargerProduits, chargerProfils, chargerVentes]);

  // ---------- Stock disponible en tenant compte du panier ----------
  const stockReserve = useMemo(() => {
    const map = {};
    panier.forEach((l) => {
      map[l.produitId] = (map[l.produitId] || 0) + l.fractionValeur * l.qte;
    });
    return map;
  }, [panier]);

  const stockDisponible = (produit) => produit.stock - (stockReserve[produit.id] || 0);

  // ---------- Panier ----------
  function ajouterAuPanier(produit, fraction) {
    const dispo = stockDisponible(produit);
    if (dispo < fraction.valeur) return;
    setPanier((prev) => {
      const existant = prev.find(
        (l) => l.produitId === produit.id && l.fractionValeur === fraction.valeur
      );
      if (existant) {
        return prev.map((l) => (l.ligneId === existant.ligneId ? { ...l, qte: l.qte + 1 } : l));
      }
      return [
        ...prev,
        {
          ligneId: genId(),
          produitId: produit.id,
          nom: produit.nom,
          fractionLabel: fraction.label,
          fractionValeur: fraction.valeur,
          prixUnitaire: produit.prix_caisse * fraction.valeur,
          qte: 1,
        },
      ];
    });
  }

  function changerQte(ligneId, delta) {
    setPanier((prev) =>
      prev
        .map((l) => {
          if (l.ligneId !== ligneId) return l;
          const produit = produits.find((p) => p.id === l.produitId);
          const nouvelleQte = l.qte + delta;
          if (nouvelleQte <= 0) return null;
          if (delta > 0) {
            const dejaReserve = stockReserve[l.produitId] || 0;
            const dispoSansCetteLigne = produit.stock - dejaReserve + l.fractionValeur * l.qte;
            if (dispoSansCetteLigne < l.fractionValeur * nouvelleQte) return l;
          }
          return { ...l, qte: nouvelleQte };
        })
        .filter(Boolean)
    );
  }

  function retirerLigne(ligneId) {
    setPanier((prev) => prev.filter((l) => l.ligneId !== ligneId));
  }

  function viderPanier() {
    setPanier([]);
  }

  const totalPanier = panier.reduce((s, l) => s + l.prixUnitaire * l.qte, 0);

  // ---------- Checkout ----------
  function ouvrirCheckout() {
    if (panier.length === 0) return;
    setMontantRecu("");
    setModePaiement("Cash");
    setErreur("");
    setModalCheckout(true);
  }

  async function confirmerVente() {
    const recuNum = parseFloat(montantRecu) || 0;
    if (modePaiement === "Cash" && recuNum < totalPanier) return;
    setEnTraitement(true);
    setErreur("");

    const { data: venteInseree, error: erreurVente } = await supabase
      .from("ventes")
      .insert({
        vendeur_id: session.user.id,
        total: totalPanier,
        mode_paiement: modePaiement,
        montant_recu: modePaiement === "Cash" ? recuNum : totalPanier,
        monnaie: modePaiement === "Cash" ? recuNum - totalPanier : 0,
      })
      .select()
      .single();

    if (erreurVente) {
      setErreur("Échec de l'enregistrement de la vente. Réessaie.");
      setEnTraitement(false);
      return;
    }

    const lignes = panier.map((l) => ({
      vente_id: venteInseree.id,
      produit_id: l.produitId,
      nom: l.nom,
      fraction_label: l.fractionLabel,
      fraction_valeur: l.fractionValeur,
      prix_unitaire: l.prixUnitaire,
      qte: l.qte,
    }));
    await supabase.from("vente_lignes").insert(lignes);

    // Déduire le stock
    for (const p of produits) {
      const utilise = panier
        .filter((l) => l.produitId === p.id)
        .reduce((s, l) => s + l.fractionValeur * l.qte, 0);
      if (utilise) {
        await supabase.from("produits").update({ stock: p.stock - utilise }).eq("id", p.id);
      }
    }

    setRecu({
      lignes: panier,
      total: totalPanier,
      modePaiement,
      recu: modePaiement === "Cash" ? recuNum : totalPanier,
      monnaie: modePaiement === "Cash" ? recuNum - totalPanier : 0,
      date: new Date(),
    });
    setPanier([]);
    setModalCheckout(false);
    setEnTraitement(false);
    chargerProduits();
    chargerVentes();
  }

  // ---------- Stock admin (PDG) ----------
  async function majProduit(id, champ, valeur) {
    setProduits((prev) => prev.map((p) => (p.id === id ? { ...p, [champ]: valeur } : p)));
    await supabase.from("produits").update({ [champ]: valeur }).eq("id", id);
  }

  async function ajouterProduit() {
    const { data } = await supabase
      .from("produits")
      .insert({ nom: "Nouveau produit", categorie: "", prix_caisse: 0, stock: 0 })
      .select()
      .single();
    if (data) setProduits((prev) => [...prev, data]);
  }

  async function supprimerProduit(id) {
    setProduits((prev) => prev.filter((p) => p.id !== id));
    await supabase.from("produits").delete().eq("id", id);
  }

  // ---------- Utilisateurs (PDG) ----------
  async function changerRole(id, role) {
    setProfils((prev) => prev.map((p) => (p.id === id ? { ...p, role } : p)));
    await supabase.from("profiles").update({ role }).eq("id", id);
  }

  const ventesVisibles = estPDG ? ventes : ventes.filter((v) => v.vendeur_id === session?.user.id);
  const totalJour = ventesVisibles.reduce((s, v) => s + Number(v.total), 0);

  // ---------- Vue par défaut selon le rôle ----------
  useEffect(() => {
    if (profil) setVue(profil.role === "pdg" ? "tableau" : "vente");
  }, [profil]);

  // ---------- Données du tableau de bord (PDG) ----------
  const estAujourdhui = (dateStr) => {
    const d = new Date(dateStr);
    const now = new Date();
    return (
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate()
    );
  };

  const ventesAujourdhui = ventes.filter((v) => estAujourdhui(v.created_at));
  const totalAujourdhui = ventesAujourdhui.reduce((s, v) => s + Number(v.total), 0);

  const ventesParVendeur = useMemo(() => {
    const map = {};
    ventesAujourdhui.forEach((v) => {
      const nom = v.profiles?.nom_complet || "—";
      if (!map[nom]) map[nom] = { nom, total: 0, count: 0 };
      map[nom].total += Number(v.total);
      map[nom].count += 1;
    });
    return Object.values(map).sort((a, b) => b.total - a.total);
  }, [ventesAujourdhui]);

  const ventesParMode = useMemo(() => {
    const map = {};
    ventesAujourdhui.forEach((v) => {
      map[v.mode_paiement] = (map[v.mode_paiement] || 0) + Number(v.total);
    });
    return map;
  }, [ventesAujourdhui]);

  const produitsStockBas = produits.filter((p) => p.stock <= 1).sort((a, b) => a.stock - b.stock);
  const valeurStockTotal = produits.reduce((s, p) => s + p.stock * p.prix_caisse, 0);

  // ---------- Écran de chargement ----------
  if (chargement) {
    return <div style={styles.centre}>Chargement…</div>;
  }

  // ---------- Écran de connexion ----------
  if (!session) {
    return <EcranConnexion />;
  }

  if (!profil) {
    return <div style={styles.centre}>Chargement du profil…</div>;
  }

  return (
    <div style={styles.app}>
      <header style={styles.header}>
        <div>
          <div style={styles.titre}>POS — Vente de viande par caisse</div>
          <div style={styles.sousTitre}>
            {profil.nom_complet} — {estPDG ? "PDG" : "Vendeur(se)"}
          </div>
        </div>
        <nav style={styles.nav}>
          {(estPDG ? ["tableau", "vente", "historique", "stock", "utilisateurs"] : ["vente", "historique"])
            .map((v) => (
              <button
                key={v}
                onClick={() => setVue(v)}
                style={{ ...styles.navBtn, ...(vue === v ? styles.navBtnActif : {}) }}
              >
                {v === "tableau"
                  ? "Tableau de bord"
                  : v === "vente"
                  ? "Vente"
                  : v === "stock"
                  ? "Stock"
                  : v === "utilisateurs"
                  ? "Utilisateurs"
                  : "Historique"}
              </button>
            ))}
          <button style={styles.btnDeconnexion} onClick={() => supabase.auth.signOut()}>
            Déconnexion
          </button>
        </nav>
      </header>

      {vue === "tableau" && estPDG && (
        <div style={styles.panneauStock}>
          <div style={styles.stockHeader}>
            <div style={styles.panierTitre}>Tableau de bord — Aujourd'hui</div>
          </div>

          <div style={styles.cartesKPI}>
            <div style={styles.carteKPI}>
              <div style={styles.kpiLabel}>Ventes du jour</div>
              <div style={styles.kpiValeur}>{fmt(totalAujourdhui)} HTG</div>
              <div style={styles.kpiSousTexte}>{ventesAujourdhui.length} transaction(s)</div>
            </div>
            <div style={styles.carteKPI}>
              <div style={styles.kpiLabel}>Valeur du stock</div>
              <div style={styles.kpiValeur}>{fmt(valeurStockTotal)} HTG</div>
              <div style={styles.kpiSousTexte}>{produits.length} produit(s)</div>
            </div>
            <div style={styles.carteKPI}>
              <div style={styles.kpiLabel}>Alertes stock bas</div>
              <div style={{ ...styles.kpiValeur, color: produitsStockBas.length ? "#B3261E" : "#1A1A1A" }}>
                {produitsStockBas.length}
              </div>
              <div style={styles.kpiSousTexte}>≤ 1 caisse restante</div>
            </div>
          </div>

          <div style={styles.grilleTableau}>
            <div style={styles.blocTableau}>
              <div style={styles.blocTitre}>Ventes par vendeur (aujourd'hui)</div>
              {ventesParVendeur.length === 0 && (
                <div style={styles.panierVide}>Aucune vente aujourd'hui</div>
              )}
              {ventesParVendeur.map((v) => (
                <div key={v.nom} style={styles.ligneBloc}>
                  <span>{v.nom}</span>
                  <span>
                    {fmt(v.total)} HTG ({v.count})
                  </span>
                </div>
              ))}
            </div>

            <div style={styles.blocTableau}>
              <div style={styles.blocTitre}>Ventes par mode de paiement</div>
              {Object.keys(ventesParMode).length === 0 && (
                <div style={styles.panierVide}>Aucune vente aujourd'hui</div>
              )}
              {Object.entries(ventesParMode).map(([mode, total]) => (
                <div key={mode} style={styles.ligneBloc}>
                  <span>{mode}</span>
                  <span>{fmt(total)} HTG</span>
                </div>
              ))}
            </div>

            <div style={styles.blocTableau}>
              <div style={styles.blocTitre}>Produits à réapprovisionner</div>
              {produitsStockBas.length === 0 && (
                <div style={styles.panierVide}>Tous les stocks sont suffisants</div>
              )}
              {produitsStockBas.map((p) => (
                <div key={p.id} style={styles.ligneBloc}>
                  <span>{p.nom}</span>
                  <span style={{ color: "#B3261E", fontWeight: 700 }}>{fmt(p.stock)} caisse(s)</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {vue === "vente" && (
        <div style={styles.grilleVente}>
          <div style={styles.panneauProduits}>
            <div style={styles.grilleProduits}>
              {produits.map((produit) => {
                const dispo = stockDisponible(produit);
                return (
                  <div key={produit.id} style={styles.carteProduit}>
                    <div style={styles.nomProduit}>{produit.nom}</div>
                    <div style={styles.categorieProduit}>{produit.categorie}</div>
                    <div style={styles.prixCaisseTxt}>{fmt(produit.prix_caisse)} HTG / caisse</div>
                    <div
                      style={{ ...styles.stockTxt, color: dispo <= 0 ? "#B3261E" : "#4A5D45" }}
                    >
                      Stock: {fmt(dispo)} caisse(s)
                    </div>
                    <div style={styles.fractionsRow}>
                      {FRACTIONS.map((f) => (
                        <button
                          key={f.label}
                          disabled={dispo < f.valeur}
                          onClick={() => ajouterAuPanier(produit, f)}
                          style={{
                            ...styles.btnFraction,
                            ...(dispo < f.valeur ? styles.btnFractionDisabled : {}),
                          }}
                        >
                          {f.label}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div style={styles.panneauPanier}>
            <div style={styles.panierTitre}>Panier</div>
            <div style={styles.panierListe}>
              {panier.length === 0 && <div style={styles.panierVide}>Aucun article sélectionné</div>}
              {panier.map((l) => (
                <div key={l.ligneId} style={styles.ligneItem}>
                  <div style={styles.ligneInfo}>
                    <div style={styles.ligneNom}>
                      {l.nom} — {l.fractionLabel}
                    </div>
                    <div style={styles.lignePrix}>
                      {fmt(l.prixUnitaire)} HTG x {l.qte} = {fmt(l.prixUnitaire * l.qte)} HTG
                    </div>
                  </div>
                  <div style={styles.ligneActions}>
                    <button style={styles.btnQte} onClick={() => changerQte(l.ligneId, -1)}>
                      −
                    </button>
                    <span style={styles.qteTxt}>{l.qte}</span>
                    <button style={styles.btnQte} onClick={() => changerQte(l.ligneId, 1)}>
                      +
                    </button>
                    <button style={styles.btnRetirer} onClick={() => retirerLigne(l.ligneId)}>
                      ✕
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <div style={styles.panierFooter}>
              <div style={styles.totalRow}>
                <span>Total</span>
                <span style={styles.totalMontant}>{fmt(totalPanier)} HTG</span>
              </div>
              <div style={styles.panierBtns}>
                <button style={styles.btnVider} onClick={viderPanier} disabled={panier.length === 0}>
                  Vider
                </button>
                <button style={styles.btnEncaisser} onClick={ouvrirCheckout} disabled={panier.length === 0}>
                  Encaisser
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {vue === "stock" && estPDG && (
        <div style={styles.panneauStock}>
          <div style={styles.stockHeader}>
            <div style={styles.panierTitre}>Gestion du stock</div>
            <button style={styles.btnAjouter} onClick={ajouterProduit}>
              + Ajouter un produit
            </button>
          </div>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Nom</th>
                <th style={styles.th}>Catégorie</th>
                <th style={styles.th}>Prix / caisse (HTG)</th>
                <th style={styles.th}>Stock (caisses)</th>
                <th style={styles.th}></th>
              </tr>
            </thead>
            <tbody>
              {produits.map((p) => (
                <tr key={p.id}>
                  <td style={styles.td}>
                    <input
                      style={styles.inputTable}
                      value={p.nom}
                      onChange={(e) => majProduit(p.id, "nom", e.target.value)}
                    />
                  </td>
                  <td style={styles.td}>
                    <input
                      style={styles.inputTable}
                      value={p.categorie}
                      onChange={(e) => majProduit(p.id, "categorie", e.target.value)}
                    />
                  </td>
                  <td style={styles.td}>
                    <input
                      type="number"
                      style={styles.inputTable}
                      value={p.prix_caisse}
                      onChange={(e) => majProduit(p.id, "prix_caisse", parseFloat(e.target.value) || 0)}
                    />
                  </td>
                  <td style={styles.td}>
                    <input
                      type="number"
                      style={styles.inputTable}
                      value={p.stock}
                      onChange={(e) => majProduit(p.id, "stock", parseFloat(e.target.value) || 0)}
                    />
                  </td>
                  <td style={styles.td}>
                    <button style={styles.btnRetirer} onClick={() => supprimerProduit(p.id)}>
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {vue === "utilisateurs" && estPDG && (
        <div style={styles.panneauStock}>
          <div style={styles.stockHeader}>
            <div style={styles.panierTitre}>Utilisateurs</div>
          </div>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Nom</th>
                <th style={styles.th}>Rôle</th>
              </tr>
            </thead>
            <tbody>
              {profils.map((p) => (
                <tr key={p.id}>
                  <td style={styles.td}>{p.nom_complet}</td>
                  <td style={styles.td}>
                    <select
                      style={styles.inputTable}
                      value={p.role}
                      onChange={(e) => changerRole(p.id, e.target.value)}
                    >
                      <option value="vendeur">Vendeur(se)</option>
                      <option value="pdg">PDG</option>
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={styles.noteUtilisateurs}>
            Pour ajouter un nouveau vendeur, demande-lui de créer son compte depuis l'écran de
            connexion (onglet "Créer un compte"). Il apparaîtra ici avec le rôle "Vendeur(se)" par
            défaut.
          </div>
        </div>
      )}

      {vue === "historique" && (
        <div style={styles.panneauStock}>
          <div style={styles.stockHeader}>
            <div style={styles.panierTitre}>
              {estPDG ? "Historique des ventes (tous les vendeurs)" : "Mes ventes"}
            </div>
            <div style={styles.totalJourTxt}>
              Total: <strong>{fmt(totalJour)} HTG</strong> ({ventesVisibles.length} vente(s))
            </div>
          </div>
          {ventesVisibles.length === 0 && <div style={styles.panierVide}>Aucune vente enregistrée</div>}
          {ventesVisibles.map((v) => (
            <div key={v.id} style={styles.carteVente}>
              <div style={styles.venteHeader}>
                <span>{new Date(v.created_at).toLocaleString("fr-HT")}</span>
                {estPDG && <span>{v.profiles?.nom_complet}</span>}
                <span>{v.mode_paiement}</span>
                <span style={styles.venteTotal}>{fmt(v.total)} HTG</span>
              </div>
              <div style={styles.venteLignes}>
                {(v.vente_lignes || []).map((l) => (
                  <div key={l.id} style={styles.venteLigneTxt}>
                    {l.nom} — {l.fraction_label} x {l.qte}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {modalCheckout && (
        <div style={styles.overlay}>
          <div style={styles.modal}>
            <div style={styles.modalTitre}>Encaissement</div>
            <div style={styles.modalTotal}>{fmt(totalPanier)} HTG</div>
            <div style={styles.modeRow}>
              {MODES_PAIEMENT.map((m) => (
                <button
                  key={m}
                  onClick={() => setModePaiement(m)}
                  style={{ ...styles.btnMode, ...(modePaiement === m ? styles.btnModeActif : {}) }}
                >
                  {m}
                </button>
              ))}
            </div>
            {modePaiement === "Cash" && (
              <div style={styles.champGroupe}>
                <label style={styles.label}>Montant reçu (HTG)</label>
                <input
                  type="number"
                  style={styles.inputModal}
                  value={montantRecu}
                  onChange={(e) => setMontantRecu(e.target.value)}
                  placeholder="0"
                  autoFocus
                />
                {montantRecu !== "" && (
                  <div style={styles.monnaieTxt}>
                    {(parseFloat(montantRecu) || 0) - totalPanier >= 0
                      ? `Monnaie à rendre: ${fmt((parseFloat(montantRecu) || 0) - totalPanier)} HTG`
                      : `Manque: ${fmt(totalPanier - (parseFloat(montantRecu) || 0))} HTG`}
                  </div>
                )}
              </div>
            )}
            {erreur && <div style={styles.erreurTxt}>{erreur}</div>}
            <div style={styles.modalBtns}>
              <button style={styles.btnVider} onClick={() => setModalCheckout(false)}>
                Annuler
              </button>
              <button
                style={styles.btnEncaisser}
                onClick={confirmerVente}
                disabled={
                  enTraitement || (modePaiement === "Cash" && (parseFloat(montantRecu) || 0) < totalPanier)
                }
              >
                {enTraitement ? "…" : "Confirmer"}
              </button>
            </div>
          </div>
        </div>
      )}

      {recu && (
        <div style={styles.overlay}>
          <div style={styles.modal}>
            <div style={styles.modalTitre}>Reçu de vente</div>
            <div style={styles.recuDate}>{recu.date.toLocaleString("fr-HT")}</div>
            <div style={styles.recuLignes}>
              {recu.lignes.map((l) => (
                <div key={l.ligneId} style={styles.recuLigne}>
                  <span>
                    {l.nom} — {l.fractionLabel} x {l.qte}
                  </span>
                  <span>{fmt(l.prixUnitaire * l.qte)} HTG</span>
                </div>
              ))}
            </div>
            <div style={styles.recuTotalRow}>
              <span>Total</span>
              <span>{fmt(recu.total)} HTG</span>
            </div>
            <div style={styles.recuTotalRow}>
              <span>Mode</span>
              <span>{recu.modePaiement}</span>
            </div>
            {recu.modePaiement === "Cash" && (
              <>
                <div style={styles.recuTotalRow}>
                  <span>Reçu</span>
                  <span>{fmt(recu.recu)} HTG</span>
                </div>
                <div style={styles.recuTotalRow}>
                  <span>Monnaie</span>
                  <span>{fmt(recu.monnaie)} HTG</span>
                </div>
              </>
            )}
            <button style={styles.btnEncaisser} onClick={() => setRecu(null)}>
              Nouvelle vente
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------- Écran de connexion : sélection d'utilisateur ----------
const UTILISATEURS = [
  { nom: "Bwb", email: "pdg@spc.com" },
  { nom: "Wadeline", email: "wadeline@spc.com" },
];

function EcranConnexion() {
  const [utilisateurChoisi, setUtilisateurChoisi] = useState(null);
  const [motDePasse, setMotDePasse] = useState("");
  const [erreur, setErreur] = useState("");
  const [enTraitement, setEnTraitement] = useState(false);

  async function soumettre(e) {
    e.preventDefault();
    setErreur("");
    setEnTraitement(true);
    const { error } = await supabase.auth.signInWithPassword({
      email: utilisateurChoisi.email,
      password: motDePasse,
    });
    if (error) setErreur("Mot de passe incorrect.");
    setEnTraitement(false);
  }

  if (!utilisateurChoisi) {
    return (
      <div style={styles.centre}>
        <div style={styles.formConnexion}>
          <div style={styles.titreConnexion}>POS — Vente de viande</div>
          <div style={styles.label}>Qui êtes-vous ?</div>
          <div style={styles.pickerListe}>
            {UTILISATEURS.map((u) => (
              <button
                key={u.email}
                type="button"
                style={styles.btnUtilisateur}
                onClick={() => {
                  setErreur("");
                  setMotDePasse("");
                  setUtilisateurChoisi(u);
                }}
              >
                {u.nom}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.centre}>
      <form onSubmit={soumettre} style={styles.formConnexion}>
        <div style={styles.titreConnexion}>POS — Vente de viande</div>
        <div style={styles.champGroupe}>
          <label style={styles.label}>Utilisateur</label>
          <div style={styles.utilisateurChoisiTxt}>{utilisateurChoisi.nom}</div>
        </div>
        <div style={styles.champGroupe}>
          <label style={styles.label}>Mot de passe</label>
          <input
            type="password"
            autoFocus
            style={styles.inputModal}
            value={motDePasse}
            onChange={(e) => setMotDePasse(e.target.value)}
            placeholder="••••••••"
          />
        </div>
        {erreur && <div style={styles.erreurTxt}>{erreur}</div>}
        <div style={styles.modalBtns}>
          <button
            type="button"
            style={styles.btnVider}
            onClick={() => setUtilisateurChoisi(null)}
          >
            Retour
          </button>
          <button type="submit" style={styles.btnEncaisser} disabled={enTraitement}>
            {enTraitement ? "…" : "Se connecter"}
          </button>
        </div>
      </form>
    </div>
  );
}

// ---------- Styles ----------
const styles = {
  app: { fontFamily: "system-ui, -apple-system, sans-serif", background: "#F5F3EE", minHeight: "100vh", color: "#1A1A1A" },
  centre: { minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#F5F3EE", fontFamily: "system-ui, sans-serif" },
  formConnexion: { background: "#fff", border: "2px solid #000", padding: 24, width: 340, maxWidth: "100%", boxSizing: "border-box" },
  titreConnexion: { fontSize: 17, fontWeight: 700, marginBottom: 16, textAlign: "center" },

  header: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px 24px", background: "#1A1A1A", color: "#F5F3EE", borderBottom: "2px solid #000", flexWrap: "wrap", gap: 12 },
  titre: { fontSize: 18, fontWeight: 700 },
  sousTitre: { fontSize: 12, opacity: 0.7 },
  nav: { display: "flex", gap: 6, alignItems: "center" },
  navBtn: { padding: "8px 16px", background: "transparent", color: "#F5F3EE", border: "1px solid #555", borderRadius: 0, cursor: "pointer", fontSize: 13 },
  navBtnActif: { background: "#F5F3EE", color: "#1A1A1A", fontWeight: 700 },
  btnDeconnexion: { padding: "8px 14px", background: "transparent", color: "#F5F3EE", border: "1px solid #B3261E", borderRadius: 0, cursor: "pointer", fontSize: 12, marginLeft: 8 },

  grilleVente: { display: "grid", gridTemplateColumns: "1fr 360px", gap: 0, minHeight: "calc(100vh - 64px)" },
  panneauProduits: { padding: 20 },
  grilleProduits: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 12 },
  carteProduit: { background: "#fff", border: "1px solid #000", padding: 14 },
  nomProduit: { fontSize: 16, fontWeight: 700 },
  categorieProduit: { fontSize: 11, color: "#666", marginBottom: 8 },
  prixCaisseTxt: { fontSize: 13, marginBottom: 4 },
  stockTxt: { fontSize: 12, marginBottom: 10, fontWeight: 600 },
  fractionsRow: { display: "flex", gap: 6, flexWrap: "wrap" },
  btnFraction: { flex: "1 1 auto", padding: "8px 6px", background: "#1A1A1A", color: "#fff", border: "1px solid #000", borderRadius: 0, cursor: "pointer", fontSize: 12 },
  btnFractionDisabled: { background: "#ccc", color: "#888", cursor: "not-allowed", borderColor: "#999" },

  panneauPanier: { background: "#fff", borderLeft: "2px solid #000", display: "flex", flexDirection: "column", padding: 16 },
  panierTitre: { fontSize: 16, fontWeight: 700, marginBottom: 12 },
  panierListe: { flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 8 },
  panierVide: { fontSize: 13, color: "#888", padding: "20px 0", textAlign: "center" },
  ligneItem: { border: "1px solid #ddd", padding: 8, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 },
  ligneInfo: { flex: 1 },
  ligneNom: { fontSize: 13, fontWeight: 600 },
  lignePrix: { fontSize: 11, color: "#666" },
  ligneActions: { display: "flex", alignItems: "center", gap: 4 },
  btnQte: { width: 24, height: 24, border: "1px solid #000", background: "#fff", borderRadius: 0, cursor: "pointer", fontSize: 14, lineHeight: 1 },
  qteTxt: { minWidth: 16, textAlign: "center", fontSize: 13, fontWeight: 600 },
  btnRetirer: { width: 24, height: 24, border: "1px solid #B3261E", background: "#fff", color: "#B3261E", borderRadius: 0, cursor: "pointer", fontSize: 12, marginLeft: 4 },

  panierFooter: { borderTop: "2px solid #000", paddingTop: 12, marginTop: 12 },
  totalRow: { display: "flex", justifyContent: "space-between", fontSize: 15, fontWeight: 700, marginBottom: 12 },
  totalMontant: { fontSize: 20 },
  panierBtns: { display: "flex", gap: 8 },
  btnVider: { flex: 1, padding: "10px 0", background: "#fff", border: "1px solid #000", borderRadius: 0, cursor: "pointer", fontSize: 13 },
  btnEncaisser: { flex: 2, padding: "10px 0", background: "#1A1A1A", color: "#fff", border: "1px solid #000", borderRadius: 0, cursor: "pointer", fontSize: 13, fontWeight: 700, width: "100%" },

  panneauStock: { padding: 20 },
  stockHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 8 },
  btnAjouter: { padding: "8px 14px", background: "#1A1A1A", color: "#fff", border: "1px solid #000", borderRadius: 0, cursor: "pointer", fontSize: 13 },
  table: { width: "100%", borderCollapse: "collapse", background: "#fff" },
  th: { textAlign: "left", padding: 8, border: "1px solid #000", fontSize: 12, background: "#eee" },
  td: { padding: 6, border: "1px solid #ccc" },
  inputTable: { width: "100%", border: "1px solid #ccc", borderRadius: 0, padding: 6, fontSize: 13, boxSizing: "border-box" },
  noteUtilisateurs: { fontSize: 12, color: "#666", marginTop: 12 },
  cartesKPI: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 20 },
  carteKPI: { background: "#fff", border: "1px solid #000", padding: 16 },
  kpiLabel: { fontSize: 12, color: "#666", marginBottom: 6 },
  kpiValeur: { fontSize: 22, fontWeight: 700 },
  kpiSousTexte: { fontSize: 11, color: "#888", marginTop: 4 },
  grilleTableau: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12 },
  blocTableau: { background: "#fff", border: "1px solid #000", padding: 16 },
  blocTitre: { fontSize: 14, fontWeight: 700, marginBottom: 10 },
  ligneBloc: { display: "flex", justifyContent: "space-between", fontSize: 13, padding: "6px 0", borderBottom: "1px solid #eee" },

  totalJourTxt: { fontSize: 13 },
  carteVente: { background: "#fff", border: "1px solid #000", padding: 12, marginBottom: 8 },
  venteHeader: { display: "flex", justifyContent: "space-between", fontSize: 12, color: "#666", marginBottom: 6, gap: 8, flexWrap: "wrap" },
  venteTotal: { color: "#1A1A1A", fontWeight: 700 },
  venteLignes: { display: "flex", flexDirection: "column", gap: 2 },
  venteLigneTxt: { fontSize: 12 },

  overlay: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, zIndex: 50 },
  modal: { background: "#fff", border: "2px solid #000", padding: 20, width: 340, maxWidth: "100%" },
  modalTitre: { fontSize: 16, fontWeight: 700, marginBottom: 8 },
  modalTotal: { fontSize: 26, fontWeight: 700, marginBottom: 16 },
  modeRow: { display: "flex", gap: 6, marginBottom: 16 },
  btnMode: { flex: 1, padding: "8px 4px", border: "1px solid #000", background: "#fff", borderRadius: 0, cursor: "pointer", fontSize: 12 },
  btnModeActif: { background: "#1A1A1A", color: "#fff" },
  champGroupe: { marginBottom: 16 },
  label: { fontSize: 12, color: "#666", display: "block", marginBottom: 4 },
  inputModal: { width: "100%", padding: 10, border: "1px solid #000", borderRadius: 0, fontSize: 16, boxSizing: "border-box" },
  monnaieTxt: { fontSize: 13, marginTop: 8, fontWeight: 600 },
  modalBtns: { display: "flex", gap: 8 },
  erreurTxt: { fontSize: 12, color: "#B3261E", marginBottom: 12 },
  pickerListe: { display: "flex", flexDirection: "column", gap: 8, marginTop: 12 },
  btnUtilisateur: { padding: "14px 0", background: "#fff", border: "1px solid #000", borderRadius: 0, cursor: "pointer", fontSize: 15, fontWeight: 700 },
  utilisateurChoisiTxt: { fontSize: 15, fontWeight: 700, padding: "8px 0" },

  recuDate: { fontSize: 12, color: "#666", marginBottom: 12 },
  recuLignes: { borderTop: "1px solid #ccc", borderBottom: "1px solid #ccc", padding: "8px 0", marginBottom: 8, display: "flex", flexDirection: "column", gap: 4 },
  recuLigne: { display: "flex", justifyContent: "space-between", fontSize: 13 },
  recuTotalRow: { display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 4 },
};
